import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration, getIntegrationCredentials } from '@/lib/integrations/store';
import { listAccountCustomNs } from '@/lib/integrations/cloudflare';

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
      // Group nameservers by set, taking each one's IP straight from Cloudflare's
      // dns_records (A record, falling back to AAAA). null when CF reports none.
      const bySets = new Map<number, Array<{ host: string; ip: string | null }>>();
      for (const entry of entries) {
        const records = entry.dns_records ?? [];
        const ip =
          records.find((r) => r.type === 'A')?.value ??
          records.find((r) => r.type === 'AAAA')?.value ??
          null;
        const list = bySets.get(entry.ns_set) ?? [];
        list.push({ host: entry.ns_name, ip });
        bySets.set(entry.ns_set, list);
      }
      const sets = [...bySets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([set, nameservers]) => ({
          set,
          nameservers: nameservers.sort((a, b) => a.host.localeCompare(b.host)),
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
