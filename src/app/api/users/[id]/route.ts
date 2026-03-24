import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { hashPassword } from '@/lib/auth/password';

type RouteContext = { params: Promise<{ id: string }> };

interface UserRow {
  id: string;
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  role: string;
  active: number;
  auth_type: string;
  created_at: number;
  updated_at: number;
}

function toUserResponse(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    firstname: row.firstname,
    lastname: row.lastname,
    role: row.role,
    active: row.active === 1,
    authType: row.auth_type,
    created_at: new Date(row.created_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
  };
}

// PUT /api/users/[id]
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { username, email, firstname, lastname, role: userRole, password, active } = body;

  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Prevent deactivating the last admin
  if (active === false && existing.role === 'Administrator') {
    const adminCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'Administrator' AND active = 1").get() as { cnt: number };
    if (adminCount.cnt <= 1) {
      return NextResponse.json({ error: 'Cannot deactivate the last administrator' }, { status: 400 });
    }
  }

  // Prevent downgrading the last admin
  if (userRole && userRole !== 'Administrator' && existing.role === 'Administrator') {
    const adminCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'Administrator' AND active = 1").get() as { cnt: number };
    if (adminCount.cnt <= 1) {
      return NextResponse.json({ error: 'Cannot change role of the last administrator' }, { status: 400 });
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (username !== undefined) {
    // Check uniqueness
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (dup) return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    fields.push('username = ?'); values.push(username);
  }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (firstname !== undefined) { fields.push('firstname = ?'); values.push(firstname); }
  if (lastname !== undefined) { fields.push('lastname = ?'); values.push(lastname); }
  if (userRole !== undefined) { fields.push('role = ?'); values.push(userRole); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }

  if (password && password.length > 0) {
    const hash = await hashPassword(password);
    fields.push('password_hash = ?'); values.push(hash);
  }

  fields.push('updated_at = unixepoch()');

  if (fields.length > 1) {
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  return NextResponse.json(toUserResponse(row));
}

// DELETE /api/users/[id]
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const currentUserId = request.headers.get('x-user-id');

  if (id === currentUserId) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Prevent deleting the last admin
  if (existing.role === 'Administrator') {
    const adminCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'Administrator' AND active = 1").get() as { cnt: number };
    if (adminCount.cnt <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last administrator' }, { status: 400 });
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
