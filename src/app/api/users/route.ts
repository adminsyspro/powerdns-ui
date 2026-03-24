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

// GET /api/users
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[];
  return NextResponse.json(rows.map(toUserResponse));
}

// POST /api/users
export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { username, email, firstname, lastname, role: userRole, password, authType } = body;

  if (!username || !email || !userRole) {
    return NextResponse.json({ error: 'username, email, and role are required' }, { status: 400 });
  }

  const effectiveAuthType = authType || 'local';
  if (effectiveAuthType === 'local' && !password) {
    return NextResponse.json({ error: 'Password is required for local users' }, { status: 400 });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const passwordHash = effectiveAuthType === 'local' ? await hashPassword(password) : null;

  db.prepare(
    `INSERT INTO users (id, username, email, firstname, lastname, role, active, password_hash, auth_type)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, username, email, firstname || '', lastname || '', userRole, passwordHash, effectiveAuthType);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  return NextResponse.json(toUserResponse(row), { status: 201 });
}
