import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { normalizeUrl } from '@/lib/cache/zones';
import { listIntegrations, listIntegrationZones } from '@/lib/integrations/store';
import { listScopedZoneNames } from '@/lib/integrations/sync';
import type { IntegrationZoneStatus } from '@/lib/integrations/types';

// GET /api/integrations/stats — replication dashboard KPIs for the current
// PowerDNS connection, aggregated over active integrations.
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const conn = getConnectionFromRequest(request);
    const serverUrl = normalizeUrl(conn.url);

    const perIntegration = listIntegrations().map((integration) => {
      const scopedNames = new Set(listScopedZoneNames(serverUrl, integration.config));
      const links = listIntegrationZones(integration.id, serverUrl);

      // Status counts are intersected with the CURRENT scope: after a scope
      // change, links not yet re-marked by a sync would otherwise inflate
      // ok/error counts beyond the scope (e.g. coverage above 100%). Links
      // outside the scope count as orphans regardless of stored status.
      const counts: Record<IntegrationZoneStatus, number> = {
        ok: 0, provisioning: 0, stale: 0, error: 0, orphan: 0,
      };
      let lastActivity: number | null = null;
      for (const link of links) {
        if (link.status === 'orphan' || !scopedNames.has(link.zoneName)) counts.orphan++;
        else counts[link.status]++;
        if (lastActivity === null || link.updatedAt > lastActivity) lastActivity = link.updatedAt;
      }

      return {
        id: integration.id,
        name: integration.name,
        active: integration.active,
        scopeCount: scopedNames.size,
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
