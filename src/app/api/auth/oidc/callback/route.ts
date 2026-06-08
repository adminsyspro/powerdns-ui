import { NextRequest, NextResponse } from 'next/server';
import * as client from 'openid-client';
import { getDb } from '@/lib/cache/db';
import { createSession } from '@/lib/auth/session';
import {
  getOidcConfig,
  getOidcConfiguration,
  getPublicBaseUrl,
  extractGroupsFromClaim,
  resolveOidcRole,
  resolveOidcAppGroups,
  syncOidcGroups,
} from '@/lib/auth/oidc';
import type { UserRole } from '@/types/powerdns';

const SESSION_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

interface UserRow {
  id: string;
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  role: string;
  active: number;
  auth_type: string;
  oidc_subject: string | null;
}

function loginError(base: string, code: string) {
  return NextResponse.redirect(new URL(`/login?error=${code}`, base));
}

// GET /api/auth/oidc/callback?code&state
export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.url);
  const verifier = request.cookies.get('pdns-oidc-verifier')?.value;
  const state = request.cookies.get('pdns-oidc-state')?.value;
  const nonce = request.cookies.get('pdns-oidc-nonce')?.value;

  // Helper to clear the short-lived flow cookies on any outcome.
  const clearFlowCookies = (res: NextResponse) => {
    for (const n of ['pdns-oidc-verifier', 'pdns-oidc-state', 'pdns-oidc-nonce']) {
      res.cookies.set(n, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    }
    return res;
  };

  try {
    if (!verifier || !state) {
      return clearFlowCookies(loginError(base, 'oidc_state'));
    }
    const cfg = getOidcConfig();
    const config = await getOidcConfiguration(cfg);
    if (!config) {
      return clearFlowCookies(loginError(base, 'oidc_unavailable'));
    }

    // Rebuild the callback URL on the canonical public origin so the
    // redirect_uri sent in the token exchange matches the one used at /login
    // (OAuth requires them to be byte-identical), while preserving the
    // ?code&state query that openid-client reads from it.
    const reqUrl = new URL(request.url);
    const currentUrl = new URL(reqUrl.pathname + reqUrl.search, base);
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || !claims.sub) {
      return clearFlowCookies(loginError(base, 'oidc_no_subject'));
    }
    const sub = String(claims.sub);

    // Prefer userinfo for richer/up-to-date claims (email, name, groups).
    let info: Record<string, unknown> = { ...claims };
    try {
      const ui = await client.fetchUserInfo(config, tokens.access_token, sub);
      info = { ...claims, ...ui };
    } catch {
      // userinfo optional; fall back to id_token claims
    }

    const email = String(info[cfg.claimEmail] ?? claims.email ?? '').trim();
    const name = String(info[cfg.claimName] ?? '').trim();
    const [firstname, ...rest] = name ? name.split(' ') : [''];
    const lastname = rest.join(' ');
    const groups = extractGroupsFromClaim(info[cfg.claimGroups]);
    const role: UserRole = resolveOidcRole(groups, cfg);
    const appGroups = resolveOidcAppGroups(groups, cfg);

    if (cfg.requireAppGroupMatch && appGroups.length === 0 && role !== 'Administrator') {
      return clearFlowCookies(loginError(base, 'no_group_match'));
    }
    if (!email) {
      return clearFlowCookies(loginError(base, 'oidc_no_email'));
    }

    const db = getDb();
    // 1) match by oidc_subject (stable identity)
    let row = db.prepare('SELECT * FROM users WHERE oidc_subject = ?').get(sub) as UserRow | undefined;
    // 2) else by email
    if (!row) {
      const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
      if (byEmail) {
        // An existing local/ldap account, OR an existing OIDC account bound to a
        // DIFFERENT subject, must not be silently taken over by email match.
        if (byEmail.auth_type !== 'oidc' || (byEmail.oidc_subject && byEmail.oidc_subject !== sub)) {
          return clearFlowCookies(loginError(base, 'email_conflict'));
        }
        row = byEmail;
      }
    }

    let userId: string;
    let username: string;
    if (row) {
      if (row.active !== 1) {
        return clearFlowCookies(loginError(base, 'account_disabled'));
      }
      userId = row.id;
      username = row.username;
      // Revoke stale sessions when the IdP demotes/promotes the user's role.
      if (row.role !== role) {
        db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(userId);
      }
      // IdP is source of truth for these on each login (active row only)
      db.prepare(
        `UPDATE users SET email = ?, firstname = ?, lastname = ?, role = ?, oidc_subject = ?, auth_type = 'oidc', updated_at = unixepoch() WHERE id = ?`
      ).run(email, firstname || '', lastname || '', role, sub, userId);
    } else {
      if (!cfg.autoProvision) {
        return clearFlowCookies(loginError(base, 'user_not_provisioned'));
      }
      userId = crypto.randomUUID();
      username = String((info['preferred_username'] as string) || email).trim();
      // avoid username collision: if taken, suffix with a short sub fragment
      const taken = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
      if (taken) username = `${username}-${sub.slice(0, 6)}`;
      db.prepare(
        `INSERT INTO users (id, username, email, firstname, lastname, role, active, password_hash, auth_type, oidc_subject)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 'oidc', ?)`
      ).run(userId, username, email, firstname || '', lastname || '', role, sub);
    }

    // Sync OIDC-sourced group memberships BEFORE createSession (so the JWT snapshot includes them).
    syncOidcGroups(userId, appGroups);

    const token = await createSession({
      id: userId,
      username,
      email,
      firstname: firstname || '',
      lastname: lastname || '',
      role,
    });

    // Set session cookie directly on the redirect response.
    // (setSessionCookie uses next/headers cookies() which writes to the current
    //  request context and may not attach to a separately constructed NextResponse redirect.)
    const redirectRes = clearFlowCookies(NextResponse.redirect(new URL('/dashboard', base)));
    redirectRes.cookies.set('pdns-session', token, {
      httpOnly: true,
      secure: process.env.FORCE_HTTPS === 'true',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });
    return redirectRes;
  } catch {
    return clearFlowCookies(loginError(base, 'oidc_error'));
  }
}
