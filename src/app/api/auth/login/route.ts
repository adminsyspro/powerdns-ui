import { NextRequest, NextResponse } from 'next/server';
import { getLDAPClient, isLDAPEnabled } from '@/lib/auth/ldap';
import { createSession, setSessionCookie, clearSession, getSession } from '@/lib/auth/session';
import type { User } from '@/types/powerdns';

// POST /api/auth/login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, authType = 'local' } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    let user: User | null = null;

    if (authType === 'ldap' && isLDAPEnabled()) {
      // LDAP Authentication
      const ldap = getLDAPClient();
      const ldapUser = await ldap.authenticate(username, password);
      
      if (ldapUser) {
        user = {
          id: ldapUser.dn,
          username: ldapUser.username,
          email: ldapUser.email,
          firstname: ldapUser.firstName,
          lastname: ldapUser.lastName,
          role: ldap.getUserRole(ldapUser.groups),
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
      }
    } else {
      // Local Authentication (for development or fallback)
      // In production, check against database
      if (username === 'admin' && password === 'admin') {
        user = {
          id: '1',
          username: 'admin',
          email: 'admin@example.com',
          firstname: 'Admin',
          lastname: 'User',
          role: 'Administrator',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Create session
    const token = await createSession(user);
    await setSessionCookie(token);

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// DELETE /api/auth/login (logout)
export async function DELETE() {
  await clearSession();
  return NextResponse.json({ success: true });
}

// GET /api/auth/login (get current session)
export async function GET() {
  const session = await getSession();
  
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      email: session.email,
      role: session.role,
    },
  });
}
