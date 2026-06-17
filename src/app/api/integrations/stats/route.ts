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

      // KPI counts are bounded to the CURRENT configured scope (the coverage
      // target): after a scope change, links not yet re-marked by a sync would
      // otherwise inflate ok/error beyond the scope. Rules per link:
      //   - status 'orphan'            → orphan (genuinely orphaned)
      //   - in scope                   → its real status (auto or pinned alike)
      //   - out of scope + manual pin  → EXCLUDED from every KPI bucket: it is
      //       deliberately outside the configured scope (and never orphaned by
      //       the worker), so counting it would make coverage (ok/scope) exceed
      //       100%. It still appears in the preview table, just not in the KPIs.
      //   - out of scope + auto        → orphan
      const counts: Record<IntegrationZoneStatus, number> = {
        ok: 0, provisioning: 0, stale: 0, error: 0, orphan: 0,
      };
      let lastActivity: number | null = null;
      for (const link of links) {
        if (link.status === 'orphan') counts.orphan++;
        else if (scopedNames.has(link.zoneName)) counts[link.status]++;
        else if (link.managed === 'manual') { /* out-of-scope pin: outside the scope KPIs */ }
        else counts.orphan++;
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
