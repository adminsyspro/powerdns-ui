export interface ProxyEnvironment {
  id: string;
  name: string;
  description: string;
  tokenSha512: string;
  active: boolean;
  zoneCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyZonePermission {
  id: string;
  environmentId: string;
  zoneName: string;
  acmeEnabled: boolean;
  recordRules: ProxyRecordRule[];
  createdAt?: string;
}

export interface ProxyRecordRule {
  id: string;
  ruleType: 'exact' | 'regex';
  pattern: string;
}

// Database row types
export interface ProxyEnvironmentRow {
  id: string;
  name: string;
  description: string;
  token_sha512: string;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface ProxyZonePermissionRow {
  id: string;
  environment_id: string;
  zone_name: string;
  acme_enabled: number;
  created_at: number;
}

export interface ProxyRecordRuleRow {
  id: string;
  zone_perm_id: string;
  rule_type: 'exact' | 'regex';
  pattern: string;
  created_at: number;
}
