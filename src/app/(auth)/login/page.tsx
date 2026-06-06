'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores';

interface OidcProviderInfo {
  enabled: boolean;
  providerName: string;
  showLocalLogin: boolean;
  forceSsoRedirect: boolean;
}

const OIDC_ERROR_MESSAGES: Record<string, string> = {
  email_conflict: 'An account with this email already exists. Please sign in with your original method.',
  account_disabled: 'Your account has been disabled. Contact your administrator.',
  no_group_match: 'Your account does not belong to any authorized group.',
  user_not_provisioned: 'Your account could not be provisioned. Contact your administrator.',
  oidc_unavailable: 'SSO is currently unavailable. Please try again later.',
  oidc_error: 'An SSO error occurred. Please try again.',
  oidc_state: 'SSO session expired or invalid. Please try signing in again.',
};

function getOidcErrorMessage(code: string): string {
  return OIDC_ERROR_MESSAGES[code] ?? 'An SSO error occurred. Please try again.';
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [formData, setFormData] = React.useState({ username: '', password: '' });
  const [authType, setAuthType] = React.useState<'local' | 'ldap'>('local');
  const [ldapAvailable, setLdapAvailable] = React.useState(false);
  const [oidcProvider, setOidcProvider] = React.useState<OidcProviderInfo | null>(null);
  const [error, setError] = React.useState('');

  const localParam = searchParams.get('local');
  const isLocalOverride = localParam === '1';
  const errorParam = searchParams.get('error');

  // Check available auth providers on mount
  React.useEffect(() => {
    fetch('/api/auth/providers')
      .then((res) => res.json())
      .then((data) => {
        if (data.ldap) setLdapAvailable(true);
        if (data.oidc?.enabled) {
          const oidc: OidcProviderInfo = {
            enabled: true,
            providerName: data.oidc.providerName || 'SSO',
            showLocalLogin: data.oidc.showLocalLogin ?? true,
            forceSsoRedirect: data.oidc.forceSsoRedirect ?? false,
          };
          setOidcProvider(oidc);
          if (oidc.forceSsoRedirect && !isLocalOverride && !errorParam) {
            window.location.href = '/api/auth/oidc/login';
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, authType }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid username or password');
        return;
      }

      login(
        {
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          firstname: data.user.firstname,
          lastname: data.user.lastname,
          role: data.user.role,
          avatar: data.user.avatar,
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        data.token
      );

      router.push('/dashboard');
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const showLocalForm = !oidcProvider?.enabled || oidcProvider.showLocalLogin || isLocalOverride;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src="/powerdns-logo.png" alt="PowerDNS" className="h-12" />
          </div>
          <CardTitle className="text-2xl">PowerDNS-UI</CardTitle>
          <CardDescription>Sign in to manage your DNS infrastructure</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || errorParam) && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error || getOidcErrorMessage(errorParam!)}
            </div>
          )}

          {oidcProvider?.enabled && (
            <Button
              type="button"
              className="w-full"
              onClick={() => { window.location.href = '/api/auth/oidc/login'; }}
            >
              Continue with {oidcProvider.providerName}
            </Button>
          )}

          {oidcProvider?.enabled && showLocalForm && (
            <div className="flex items-center gap-3 my-2">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or sign in with credentials</span>
              <Separator className="flex-1" />
            </div>
          )}
        </CardContent>

        {showLocalForm && (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4 pt-0">
              {ldapAvailable && (
                <div className="flex rounded-lg border p-1 gap-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      authType === 'local'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setAuthType('local')}
                  >
                    Local
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      authType === 'ldap'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setAuthType('ldap')}
                  >
                    LDAP
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder=""
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder=""
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign in'}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginContent />
    </React.Suspense>
  );
}
