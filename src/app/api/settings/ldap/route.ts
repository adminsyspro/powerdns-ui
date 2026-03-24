import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { encrypt, decrypt } from '@/lib/crypto';

const LDAP_KEYS = [
  'ldap_enabled',
  'ldap_url',
  'ldap_base_dn',
  'ldap_bind_dn',
  'ldap_bind_password',
  'ldap_user_filter',
  'ldap_admin_group',
  'ldap_operator_group',
] as const;

const ENCRYPTED_KEYS = ['ldap_bind_password'];

// GET /api/settings/ldap
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const rows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${LDAP_KEYS.map(() => '?').join(',')})`
  ).all(...LDAP_KEYS) as Array<{ key: string; value: string }>;

  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = ENCRYPTED_KEYS.includes(row.key) ? decrypt(row.value) : row.value;
  }

  return NextResponse.json({
    enabled: config.ldap_enabled === 'true',
    url: config.ldap_url || '',
    baseDN: config.ldap_base_dn || '',
    bindDN: config.ldap_bind_dn || '',
    bindPassword: config.ldap_bind_password || '',
    userFilter: config.ldap_user_filter || '(uid={{username}})',
    adminGroup: config.ldap_admin_group || 'pdns-admins',
    operatorGroup: config.ldap_operator_group || 'pdns-operators',
  });
}

// PUT /api/settings/ldap
export async function PUT(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const db = getDb();

  const mapping: Record<string, string> = {
    ldap_enabled: String(!!body.enabled),
    ldap_url: body.url || '',
    ldap_base_dn: body.baseDN || '',
    ldap_bind_dn: body.bindDN || '',
    ldap_bind_password: body.bindPassword || '',
    ldap_user_filter: body.userFilter || '(uid={{username}})',
    ldap_admin_group: body.adminGroup || 'pdns-admins',
    ldap_operator_group: body.operatorGroup || 'pdns-operators',
  };

  const stmt = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(mapping)) {
      const storedValue = ENCRYPTED_KEYS.includes(key) && value ? encrypt(value) : value;
      stmt.run(key, storedValue);
    }
  });
  transaction();

  return NextResponse.json({ success: true });
}
