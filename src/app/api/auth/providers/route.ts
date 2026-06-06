import { NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { getPublicOidcInfo } from '@/lib/auth/oidc';

// GET /api/auth/providers — public endpoint, returns available auth methods
export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ldap_enabled'").get() as { value: string } | undefined;
  const ldapEnabled = row?.value === 'true';

  let oidc = { enabled: false, providerName: 'SSO', showLocalLogin: true, forceSsoRedirect: false };
  try {
    oidc = getPublicOidcInfo();
  } catch {
    // DB not ready or config missing — return safe defaults
  }

  return NextResponse.json({
    local: true,
    ldap: ldapEnabled,
    oidc,
  });
}
