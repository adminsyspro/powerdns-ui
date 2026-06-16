import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration, getIntegrationCredentials } from '@/lib/integrations/store';
import { listAccountCustomNs } from '@/lib/integrations/cloudflare';
import { resolve4 } from 'dns/promises';

// Bounded IPv4 lookup: first A record, or null on error/timeout — so a slow or
// blackholed nameserver can't stall the response. Lookups run in parallel, so the
// whole request waits at most `timeoutMs`.
async function resolveIpv4(host: string, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    resolve4(host)
      .then((ips) => resolve(ips[0] ?? null))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timer));
  });
}

// POST /api/integrations/custom-ns-sets — list the custom nameserver sets of
// a Cloudflare account, for the set selector in the integration dialog.
// Credentials come from an existing integration (integrationId) or, during
// creation, from the token being typed into the form (apiToken).
export async function POST(request: NextRequest) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const accountId = String(body.accountId ?? '').trim();
    if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

    let apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
    if (!apiToken && typeof body.integrationId === 'string') {
      const integration = getIntegration(body.integrationId);
      if (integration) apiToken = getIntegrationCredentials(integration.id)?.apiToken ?? '';
    }
    if (!apiToken) {
      return NextResponse.json({ error: 'Provide apiToken or integrationId' }, { status: 400 });
    }

    try {
      const entries = await listAccountCustomNs({ apiToken }, accountId);
      const bySets = new Map<number, string[]>();
      for (const entry of entries) {
        const list = bySets.get(entry.ns_set) ?? [];
        list.push(entry.ns_name);
        bySets.set(entry.ns_set, list);
      }
      // Resolve each unique nameserver's IPv4 (A) record once, in parallel.
      // Best-effort and time-bounded: a failed or slow lookup yields null and
      // never stalls the request (see resolveIpv4).
      const uniqueHosts = [...new Set(entries.map((e) => e.ns_name))];
      const ipByHost = new Map<string, string | null>();
      await Promise.all(
        uniqueHosts.map(async (host) => {
          ipByHost.set(host, await resolveIpv4(host));
        })
      );
      const sets = [...bySets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([set, nameservers]) => ({
          set,
          nameservers: nameservers
            .sort((a, b) => a.localeCompare(b))
            .map((host) => ({ host, ip: ipByHost.get(host) ?? null })),
        }));
      return NextResponse.json({ sets });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Cloudflare lookup failed' },
        { status: 502 }
      );
    }
  } catch (e) {
    return authzErrorResponse(e);
  }
}
