import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import type { User, UserRole } from '@/types/powerdns';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'your-secret-key-change-in-production'
);
const COOKIE_NAME = 'pdns-session';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export interface SessionPayload {
  userId: string;
  username: string;
  email: string;
  role: UserRole;
  exp: number;
}

export async function createSession(user: Omit<User, 'created_at' | 'updated_at' | 'active'>): Promise<string> {
  const exp = Math.floor((Date.now() + SESSION_DURATION) / 1000);
  
  const token = await new SignJWT({
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(JWT_SECRET);

  return token;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  
  if (!token) {
    return null;
  }

  return verifySession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/',
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function requireRole(session: SessionPayload | null, ...roles: UserRole[]): boolean {
  if (!session) return false;
  return roles.includes(session.role);
}

export function isAdmin(session: SessionPayload | null): boolean {
  return requireRole(session, 'Administrator');
}

export function isOperatorOrAdmin(session: SessionPayload | null): boolean {
  return requireRole(session, 'Administrator', 'Operator');
}
