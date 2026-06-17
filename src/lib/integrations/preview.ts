import type { CfZone } from './cloudflare';
import type { IntegrationZoneRow, IntegrationZoneStatus } from './types';

export type ZonePreviewState = 'tracked' | 'adopt' | 'create' | 'cf-only' | 'unknown';

export interface ZonePreviewRow {
  zoneName: string;
  previewState: ZonePreviewState;
  inPdnsScope: boolean;
  account: string | null;
  cfPresent: boolean;
  cfType: string | null;
  cfZoneId: string | null;
  syncable: boolean;
  status?: IntegrationZoneStatus;
  message?: string | null;
  remoteType?: string | null;
  remoteZoneId?: string | null;
  customNsSet?: number | null;
  updatedAt?: number;
}

/** Lower-case + strip a single trailing dot. DNS names are case-insensitive. */
function joinKey(name: string): string {
  return name.replace(/\.$/, '').toLowerCase();
}

export function computePreviewRows(
  pdnsZones: Array<{ name: string; account: string }>,
  cfZones: CfZone[] | null,           // null = no CF data available at all
  trackedRows: IntegrationZoneRow[],
): ZonePreviewRow[] {
  const pdnsByKey = new Map(pdnsZones.map((z) => [joinKey(z.name), z]));
  const cfByKey = cfZones ? new Map(cfZones.map((z) => [joinKey(z.name), z])) : null;
  const trackedByKey = new Map(trackedRows.map((r) => [joinKey(r.zoneName), r]));

  const keys = new Set<string>([...pdnsByKey.keys(), ...trackedByKey.keys()]);
  if (cfByKey) for (const k of cfByKey.keys()) keys.add(k);

  const rows: ZonePreviewRow[] = [];
  for (const key of keys) {
    const pdns = pdnsByKey.get(key);
    const cf = cfByKey?.get(key) ?? null;
    const tr = trackedByKey.get(key);
    const inPdnsScope = Boolean(pdns);
    const cfPresent = Boolean(cf);

    let previewState: ZonePreviewState;
    if (tr) previewState = 'tracked';
    else if (inPdnsScope && cfByKey === null) previewState = 'unknown';
    else if (inPdnsScope && cfPresent) previewState = 'adopt';
    else if (inPdnsScope) previewState = 'create';
    else previewState = 'cf-only';

    const status = tr?.status;
    const syncable = inPdnsScope && status !== 'provisioning';

    rows.push({
      zoneName: pdns?.name ?? tr?.zoneName ?? cf?.name ?? key,
      previewState,
      inPdnsScope,
      account: pdns?.account ?? null,
      cfPresent,
      cfType: cf?.type ?? tr?.remoteType ?? null,
      cfZoneId: cf?.id ?? tr?.remoteZoneId ?? null,
      syncable,
      ...(tr
        ? {
            status: tr.status,
            message: tr.message,
            remoteType: tr.remoteType,
            remoteZoneId: tr.remoteZoneId,
            customNsSet: tr.customNsSet,
            updatedAt: tr.updatedAt,
          }
        : {}),
    });
  }
  rows.sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  return rows;
}
