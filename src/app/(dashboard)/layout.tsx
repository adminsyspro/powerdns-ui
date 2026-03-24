'use client';

import { useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { useServerConnectionStore, useAuthStore } from '@/stores';
import { setConnectionGetter } from '@/lib/api';
import { useSyncPoller } from '@/hooks/use-pdns';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Validate session on mount — sync server cookie with client store
  useEffect(() => {
    fetch('/api/auth/login')
      .then((res) => {
        if (!res.ok) {
          useAuthStore.getState().logout();
          window.location.href = '/login';
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.user) {
          useAuthStore.getState().setUser({
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
          });
        }
      })
      .catch(() => {
        // Network error — leave current state
      });
  }, []);

  // Load server connections from SQLite on startup
  useEffect(() => {
    useServerConnectionStore.getState().loadConnections();
  }, []);

  // Initialize the API connection getter from the Zustand store
  useEffect(() => {
    setConnectionGetter(() => {
      const conn = useServerConnectionStore.getState().activeConnection;
      if (!conn) return null;
      return { url: conn.url, apiKey: conn.apiKey };
    });
  }, []);

  // Auto-sync zones cache every 5 minutes
  useSyncPoller(300_000);

  return <MainLayout>{children}</MainLayout>;
}
