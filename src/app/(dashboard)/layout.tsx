'use client';

import { useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { useServerConnectionStore } from '@/stores';
import { setConnectionGetter } from '@/lib/api';
import { useSyncPoller } from '@/hooks/use-pdns';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
