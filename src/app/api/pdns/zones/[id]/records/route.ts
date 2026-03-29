import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, getConnectionFromRequest } from '@/lib/pdns-proxy';

type RouteContext = { params: Promise<{ id: string }> };

interface FlatRecord {
  name: string;
  type: string;
  ttl: number;
  content: string;
  disabled: boolean;
  comments: Array<{ content: string; account: string; modified_at: number }>;
}

const TYPE_ORDER: Record<string, number> = {
  SOA: 0, NS: 1, A: 2, AAAA: 3, CNAME: 4, MX: 5, TXT: 6, SRV: 7,
  CAA: 8, PTR: 9, DS: 10, DNSKEY: 11, NAPTR: 12, SSHFP: 13, TLSA: 14,
};

/**
 * GET /api/pdns/zones/[id]/records
 *
 * Fetches all rrsets from PowerDNS, then applies server-side
 * filtering, sorting, and pagination before returning to the client.
 *
 * Query params:
 *   page      - page number (default: 1)
 *   pageSize  - records per page (default: 50)
 *   search    - filter by name or content (case-insensitive)
 *   type      - filter by record type (e.g. "A", "CNAME")
 *   sortBy    - "name" | "type" | "ttl" | "content" (default: "type")
 *   sortOrder - "asc" | "desc" (default: "asc")
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}?rrsets=true`);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: data.error || `PowerDNS returned ${response.status}` },
        { status: response.status }
      );
    }

    const zone = await response.json();
    const rrsets: Array<{
      name: string;
      type: string;
      ttl: number;
      records: Array<{ content: string; disabled: boolean }>;
      comments?: Array<{ content: string; account: string; modified_at: number }>;
    }> = zone.rrsets || [];

    // Flatten rrsets into individual records
    const flat: FlatRecord[] = [];
    for (const rrset of rrsets) {
      for (const rec of rrset.records) {
        flat.push({
          name: rrset.name,
          type: rrset.type,
          ttl: rrset.ttl,
          content: rec.content,
          disabled: rec.disabled,
          comments: rrset.comments || [],
        });
      }
    }

    // Parse query params
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get('pageSize') || '50', 10)));
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const typeFilter = url.searchParams.get('type') || '';
    const sortBy = url.searchParams.get('sortBy') || 'type';
    const sortOrder = url.searchParams.get('sortOrder') || 'asc';

    // Filter
    let filtered = flat;
    if (search) {
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(search) || r.content.toLowerCase().includes(search)
      );
    }
    if (typeFilter && typeFilter !== 'all') {
      filtered = filtered.filter((r) => r.type === typeFilter);
    }

    // Compute type stats (on filtered-by-search, before type filter)
    let forStats = flat;
    if (search) {
      forStats = forStats.filter(
        (r) => r.name.toLowerCase().includes(search) || r.content.toLowerCase().includes(search)
      );
    }
    const typeStats: Record<string, number> = {};
    for (const r of forStats) {
      typeStats[r.type] = (typeStats[r.type] || 0) + 1;
    }

    // Sort
    const dir = sortOrder === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
      if (sortBy === 'ttl') return dir * (a.ttl - b.ttl);
      if (sortBy === 'content') return dir * a.content.localeCompare(b.content);
      // Default: sort by type order, then name
      const ta = TYPE_ORDER[a.type] ?? 99;
      const tb = TYPE_ORDER[b.type] ?? 99;
      if (ta !== tb) return dir * (ta - tb);
      return dir * a.name.localeCompare(b.name);
    });

    // Paginate
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages,
      typeStats,
      // Return the full rrsets so pending changes can still be merged on the client
      rrsets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
