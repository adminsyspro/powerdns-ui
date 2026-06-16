import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration, getIntegrationCredentials } from '@/lib/integrations/store';
import { listAccountCustomNs } from '@/lib/integrations/cloudflare';
import { resolve4 } from 'dns/promises';

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
      // Best-effort: a failed lookup yields null and never fails the request.
      const uniqueHosts = [...new Set(entries.map((e) => e.ns_name))];
      const ipByHost = new Map<string, string | null>();
      await Promise.all(
        uniqueHosts.map(async (host) => {
          try {
            const ips = await resolve4(host);
            ipByHost.set(host, ips[0] ?? null);
          } catch {
            ipByHost.set(host, null);
          }
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
