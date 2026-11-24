import { NextResponse } from 'next/server';
import { authzErrorResponse, AuthzError } from '@/lib/auth/authz';

/** Map errors from distribution routes: authz → its status, "not found" → 404, anything else → 400 with the message. */
export function distributionErrorResponse(e: unknown): NextResponse {
  if (e instanceof AuthzError) return authzErrorResponse(e);
  const msg = e instanceof Error ? e.message : String(e);
  const status = /not found/i.test(msg) ? 404 : 400;
  return NextResponse.json({ error: msg }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch { /* fallthrough */ }
  throw new Error('invalid JSON body');
}
