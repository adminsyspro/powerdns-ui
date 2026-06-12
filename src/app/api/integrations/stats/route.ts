import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { normalizeUrl } from '@/lib/cache/zones';
import { listIntegrations, getIntegrationZoneStats } from '@/lib/integrations/store';
import { countScopedZones } from '@/lib/integrations/sync';

// GET /api/integrations/stats — replication dashboard KPIs for the current
// PowerDNS connection, aggregated over active integrations.
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const conn = getConnectionFromRequest(request);
    const serverUrl = normalizeUrl(conn.url);

    const perIntegration = listIntegrations().map((integration) => {
      const { counts, lastActivity } = getIntegrationZoneStats(integration.id, serverUrl);
      return {
        id: integration.id,
        name: integration.name,
        active: integration.active,
        scopeCount: countScopedZones(serverUrl, integration.config),
        counts,
        lastActivity,
      };
    });

    const totals = perIntegration
      .filter((entry) => entry.active)
      .reduce(
        (acc, entry) => ({
          scope: acc.scope + entry.scopeCount,
          ok: acc.ok + entry.counts.ok,
          error: acc.error + entry.counts.error,
          pending: acc.pending + entry.counts.provisioning + entry.counts.stale,
          orphan: acc.orphan + entry.counts.orphan,
          lastActivity:
            entry.lastActivity !== null && (acc.lastActivity === null || entry.lastActivity > acc.lastActivity)
              ? entry.lastActivity
              : acc.lastActivity,
        }),
        { scope: 0, ok: 0, error: 0, pending: 0, orphan: 0, lastActivity: null as number | null }
      );

    return NextResponse.json({ totals, integrations: perIntegration });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
