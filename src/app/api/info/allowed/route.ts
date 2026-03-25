import { NextRequest, NextResponse } from 'next/server';
import { authenticateProxyRequest, isAuthError, logProxy } from '@/lib/proxy/auth';
import { getZonePermissions } from '@/lib/proxy/access-control';

// GET /api/info/allowed — returns zones/permissions for the calling token
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const auth = authenticateProxyRequest(request);
  if (isAuthError(auth)) {
    logProxy(request, 401, { startTime, error: 'Authentication failed' });
    return auth;
  }

  const { environment } = auth;
  const permissions = getZonePermissions(environment.id);

  logProxy(request, 200, { environment, startTime });

  return NextResponse.json({
    environment: environment.name,
    zones: permissions.map((z) => ({
      name: z.zoneName,
      acmeEnabled: z.acmeEnabled,
      recordRules: z.recordRules.map((r) => ({
        type: r.ruleType,
        pattern: r.pattern,
      })),
      allRecords: z.recordRules.length === 0 && !z.acmeEnabled,
    })),
  });
}
