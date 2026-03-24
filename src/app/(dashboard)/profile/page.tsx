'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores';
import { User, Mail, Shield, Clock, KeyRound, Save, Loader2 } from 'lucide-react';

export default function ProfilePage() {
  const { user, setUser } = useAuthStore();

  const [profile, setProfile] = React.useState({
    firstname: '',
    lastname: '',
    email: '',
  });
  const [passwords, setPasswords] = React.useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [profileLoading, setProfileLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordMessage, setPasswordMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [authType, setAuthType] = React.useState<string>('local');
  const [createdAt, setCreatedAt] = React.useState<string>('');
  const [avatar, setAvatar] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setProfile({ firstname: data.firstname || '', lastname: data.lastname || '', email: data.email || '' });
          setAuthType(data.authType || 'local');
          setCreatedAt(data.created_at || '');
          setAvatar(data.avatar || null);
        }
        setProfileLoading(false);
      })
      .catch(() => setProfileLoading(false));
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (res.ok) {
        const data = await res.json();
        setMessage({ type: 'success', text: 'Profile updated successfully.' });
        if (user) {
          setUser({ ...user, firstname: data.firstname, lastname: data.lastname, email: data.email });
        }
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Error saving profile.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Error saving profile.' });
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    setPasswordMessage(null);
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (passwords.newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      });
      if (res.ok) {
        setPasswordMessage({ type: 'success', text: 'Password changed successfully.' });
        setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        const err = await res.json();
        setPasswordMessage({ type: 'error', text: err.error || 'Error changing password.' });
      }
    } catch {
      setPasswordMessage({ type: 'error', text: 'Error changing password.' });
    }
    setSavingPassword(false);
  };

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">Manage your account information</p>
      </div>

      {/* User overview */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatar || user?.avatar || undefined} alt={user?.username || 'User'} />
              <AvatarFallback className="text-2xl bg-muted">
                {user?.username?.slice(0, 2).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold">
                {profile.firstname || profile.lastname
                  ? `${profile.firstname} ${profile.lastname}`.trim()
                  : user?.username}
              </h2>
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{user?.username}</span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant="outline" className="gap-1">
                  <Shield className="h-3 w-3" />
                  {user?.role}
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  {authType === 'ldap' ? 'LDAP' : 'Local'}
                </Badge>
                {createdAt && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Member since {new Date(createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personal Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Personal Information
          </CardTitle>
          <CardDescription>Update your name and email address</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstname">First Name</Label>
              <Input
                id="firstname"
                value={profile.firstname}
                onChange={(e) => setProfile({ ...profile, firstname: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastname">Last Name</Label>
              <Input
                id="lastname"
                value={profile.lastname}
                onChange={(e) => setProfile({ ...profile, lastname: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                className="pl-10"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              />
            </div>
          </div>
          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200'}`}>
              {message.text}
            </div>
          )}
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Change Password — only for local auth */}
      {authType !== 'ldap' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Change Password
            </CardTitle>
            <CardDescription>Update your password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={passwords.currentPassword}
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              />
            </div>
            <Separator />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={passwords.newPassword}
                  onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={passwords.confirmPassword}
                  onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
                />
              </div>
            </div>
            {passwordMessage && (
              <div className={`p-3 rounded-lg text-sm ${passwordMessage.type === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200'}`}>
                {passwordMessage.text}
              </div>
            )}
            <Button
              onClick={handleChangePassword}
              disabled={savingPassword || !passwords.currentPassword || !passwords.newPassword}
            >
              {savingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Change Password
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
