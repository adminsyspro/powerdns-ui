// src/lib/bind/types.ts
import type { RRSet, RecordType } from '@/types/powerdns';

export type ParsedRRSet = RRSet;

export interface BindWarning {
  line: number;
  message: string;
  owner?: string;
  type?: string;
}

export interface BindError {
  line: number;
  message: string;
  rawLine?: string;
}

export interface ImportPreview {
  rrsets: ParsedRRSet[];
  warnings: BindWarning[];
  errors: BindError[];
  detectedOrigin: string | null;
  typeStats: Record<string, number>;
}

export const SUPPORTED_RECORD_TYPES: ReadonlySet<RecordType> = new Set([
  'A', 'AAAA', 'AFSDB', 'ALIAS', 'CAA', 'CERT', 'CDNSKEY', 'CDS', 'CNAME',
  'DNSKEY', 'DNAME', 'DS', 'HINFO', 'KEY', 'LOC', 'MX', 'NAPTR', 'NS',
  'NSEC', 'NSEC3', 'NSEC3PARAM', 'OPENPGPKEY', 'PTR', 'RP', 'RRSIG', 'SOA',
  'SPF', 'SSHFP', 'SRV', 'TKEY', 'TSIG', 'TLSA', 'SMIMEA', 'TXT', 'URI',
]);
