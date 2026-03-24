'use client';

import * as React from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { cn } from '@/lib/utils';
import { useUIPreferencesStore } from '@/stores';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarCollapsed } = useUIPreferencesStore();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main
          className={cn(
            'flex-1 overflow-auto bg-muted/30 p-6',
            'transition-all duration-300'
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
