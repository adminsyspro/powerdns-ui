import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { hashPassword } from '@/lib/auth/password';

interface UserRow {
  id: string;
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  role: string;
  active: number;
  auth_type: string;
  avatar: string | null;
  created_at: number;
  updated_at: number;
}

// GET /api/profile — return current user's profile
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const row = db.prepare('SELECT id, username, email, firstname, lastname, role, active, auth_type, avatar, created_at, updated_at FROM users WHERE id = ?').get(userId) as UserRow | undefined;

  if (!row) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    username: row.username,
    email: row.email,
    firstname: row.firstname,
    lastname: row.lastname,
    role: row.role,
    active: row.active === 1,
    authType: row.auth_type,
    avatar: row.avatar,
    created_at: new Date(row.created_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
  });
}

// PUT /api/profile — update current user's own profile
export async function PUT(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { email, firstname, lastname, currentPassword, newPassword } = body;

  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as (UserRow & { password_hash: string }) | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (email !== undefined) {
    fields.push('email = ?');
    values.push(email);
  }
  if (firstname !== undefined) {
    fields.push('firstname = ?');
    values.push(firstname);
  }
  if (lastname !== undefined) {
    fields.push('lastname = ?');
    values.push(lastname);
  }

  if (newPassword && newPassword.length > 0) {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
    }
    // Verify current password
    const { verifyPassword } = await import('@/lib/auth/password');
    const valid = await verifyPassword(currentPassword, existing.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }
    const hash = await hashPassword(newPassword);
    fields.push('password_hash = ?');
    values.push(hash);
  }

  fields.push('updated_at = unixepoch()');

  if (fields.length > 1) {
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, userId);
  }

  const row = db.prepare('SELECT id, username, email, firstname, lastname, role, active, auth_type, avatar, created_at, updated_at FROM users WHERE id = ?').get(userId) as UserRow;
  return NextResponse.json({
    id: row.id,
    username: row.username,
    email: row.email,
    firstname: row.firstname,
    lastname: row.lastname,
    role: row.role,
    active: row.active === 1,
    authType: row.auth_type,
    avatar: row.avatar,
    created_at: new Date(row.created_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
  });
}
