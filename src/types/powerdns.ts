// PowerDNS API Types

export type ZoneKind = 'Native' | 'Master' | 'Slave' | 'Producer' | 'Consumer';

export type RecordType =
  | 'A'
  | 'AAAA'
  | 'AFSDB'
  | 'ALIAS'
  | 'CAA'
  | 'CERT'
  | 'CDNSKEY'
  | 'CDS'
  | 'CNAME'
  | 'DNSKEY'
  | 'DNAME'
  | 'DS'
  | 'HINFO'
  | 'KEY'
  | 'LOC'
  | 'MX'
  | 'NAPTR'
  | 'NS'
  | 'NSEC'
  | 'NSEC3'
  | 'NSEC3PARAM'
  | 'OPENPGPKEY'
  | 'PTR'
  | 'RP'
  | 'RRSIG'
  | 'SOA'
  | 'SPF'
  | 'SSHFP'
  | 'SRV'
  | 'TKEY'
  | 'TSIG'
  | 'TLSA'
  | 'SMIMEA'
  | 'TXT'
  | 'URI';

export interface Record {
  content: string;
  disabled: boolean;
}

export interface Comment {
  content: string;
  account: string;
  modified_at: number;
}

export interface RRSet {
  name: string;
  type: RecordType;
  ttl: number;
  changetype?: 'REPLACE' | 'DELETE' | 'EXTEND';
  records: Record[];
  comments?: Comment[];
}

export interface Zone {
  id: string;
  name: string;
  url: string;
  kind: ZoneKind;
  dnssec: boolean;
  account: string;
  masters: string[];
  serial: number;
  notified_serial: number;
  edited_serial: number;
  last_check: number;
  soa_edit: string;
  soa_edit_api: string;
  api_rectify: boolean;
  nsec3param: string;
  nsec3narrow: boolean;
  presigned: boolean;
  rrsets?: RRSet[];
  catalog?: string;
  master_tsig_key_ids?: string[];
  slave_tsig_key_ids?: string[];
}

export interface ZoneListItem {
  id: string;
  name: string;
  url: string;
  kind: ZoneKind;
  dnssec: boolean;
  account: string;
  serial: number;
  edited_serial: number;
  notified_serial: number;
  last_check: number;
}

export interface Server {
  id: string;
  type: string;
  daemon_type: string;
  version: string;
  url: string;
  config_url: string;
  zones_url: string;
}

export interface ServerConfig {
  name: string;
  type: string;
  value: string;
}

export interface ServerStatistic {
  name: string;
  type: string;
  value: string;
}

export interface CryptoKey {
  id: number;
  type: string;
  keytype: string;
  active: boolean;
  published: boolean;
  dnskey: string;
  ds: string[];
  cds: string[];
  privatekey?: string;
  algorithm: string;
  bits: number;
}

export interface TSIGKey {
  name: string;
  id: string;
  algorithm: string;
  key: string;
  type: string;
}

export interface Metadata {
  kind: string;
  metadata: string[];
}

export interface SearchResult {
  content: string;
  disabled: boolean;
  name: string;
  object_type: 'record' | 'zone' | 'comment';
  zone: string;
  zone_id: string;
  type?: RecordType;
  ttl?: number;
}

// Zone Template Types
export interface ZoneTemplate {
  id: string;
  name: string;
  description: string;
  records: TemplateRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateRecord {
  name: string;
  type: RecordType;
  content: string;
  ttl: number;
  priority?: number;
}

// User and Auth Types
export interface User {
  id: string;
  username: string;
  email: string;
  firstname?: string;
  lastname?: string;
  role: UserRole;
  active: boolean;
  otp_secret?: string;
  created_at: Date;
  updated_at: Date;
}

export type UserRole = 'Administrator' | 'Operator' | 'User';

export interface ApiKey {
  id: string;
  key: string;
  description: string;
  domains: string[];
  role: UserRole;
  created_at: Date;
}

// Activity Log
export interface ActivityLog {
  id: string;
  action: string;
  resource: string;
  user: string;
  details: string;
  timestamp: Date;
}

// Server Connection Config
export interface ServerConnection {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  version?: string;
  isDefault: boolean;
  lastConnected?: Date;
}

// Dashboard Statistics
export interface DashboardStats {
  totalZones: number;
  totalRecords: number;
  nativeZones: number;
  masterZones: number;
  slaveZones: number;
  dnssecEnabled: number;
  recentChanges: ActivityLog[];
  queryStats?: {
    total: number;
    success: number;
    failed: number;
    latency: number;
  };
}

// API Response Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Form Types
export interface CreateZoneForm {
  name: string;
  kind: ZoneKind;
  nameservers: string[];
  masters?: string[];
  account?: string;
  dnssec?: boolean;
  soa_edit_api?: string;
  template?: string;
}

export interface CreateRecordForm {
  name: string;
  type: RecordType;
  content: string;
  ttl: number;
  disabled?: boolean;
  priority?: number;
}

export interface UpdateRecordForm extends CreateRecordForm {
  changetype: 'REPLACE' | 'DELETE';
}

// Filter Types
export interface ZoneFilters {
  search?: string;
  kind?: ZoneKind;
  dnssec?: boolean;
  account?: string;
}

export interface RecordFilters {
  search?: string;
  type?: RecordType;
  disabled?: boolean;
}

// Pending Changes (batch editing)
export type ChangeAction = 'ADD' | 'EDIT' | 'DELETE' | 'TOGGLE';

export interface PendingChange {
  id: string;
  zoneId: string;
  action: ChangeAction;
  rrsetKey: string;              // `${name}::${type}`
  before: RRSet | null;
  after: RRSet | null;
  createdAt: number;
}

export interface ChangesetSubmission {
  id: string;
  zoneId: string;
  zoneName: string;
  changes: PendingChange[];
  reason: string;
  user: string;
  submittedAt: number;
  status: 'success' | 'error';
  errorMessage?: string;
}
