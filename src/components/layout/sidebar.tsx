'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Globe,
  Server,
  FileText,
  Users,
  Settings,
  LayoutDashboard,
  Shield,
  ChevronLeft,
  ChevronRight,
  Activity,
  Database,
  Layers,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIPreferencesStore, useAuthStore } from '@/stores';
import type { UserRole } from '@/types/powerdns';

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  requiredRole?: UserRole[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navigation: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'DNS Management',
    items: [
      { title: 'Zones', href: '/zones', icon: Globe },
      { title: 'API Proxy', href: '/proxy', icon: Shield, requiredRole: ['Administrator'] },
      { title: 'Templates', href: '/templates', icon: Layers },
    ],
  },
  {
    title: 'Server',
    items: [
      { title: 'Servers', href: '/servers', icon: Server },
      { title: 'Statistics', href: '/statistics', icon: Activity },
      { title: 'Configuration', href: '/configuration', icon: Database },
    ],
  },
  {
    title: 'Administration',
    items: [
      { title: 'Users', href: '/users', icon: Users, requiredRole: ['Administrator'] },
      { title: 'Change History', href: '/history', icon: History },
      { title: 'Activity Log', href: '/activity', icon: FileText },
      { title: 'Settings', href: '/settings', icon: Settings, requiredRole: ['Administrator'] },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed } = useUIPreferencesStore();
  const { user } = useAuthStore();

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'relative flex h-screen flex-col border-r border-slate-700 dark:border-border bg-slate-900 text-slate-100 dark:bg-card dark:text-card-foreground transition-all duration-300',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-slate-700 dark:border-border px-4">
          {!sidebarCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <img src="/powerdns-logo.png" alt="PowerDNS" className="h-8" />
              <span className="font-semibold">PowerDNS-UI</span>
            </Link>
          )}
          {sidebarCollapsed && (
            <Link href="/dashboard" className="mx-auto">
              <img src="/powerdns-logo.png" alt="PowerDNS" className="h-8 w-8 object-cover object-left" />
            </Link>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="space-y-6">
            {navigation.map((group) => {
              const visibleItems = group.items.filter(
                (item) => !item.requiredRole || (user && item.requiredRole.includes(user.role))
              );
              if (visibleItems.length === 0) return null;
              return (
              <div key={group.title}>
                {!sidebarCollapsed && (
                  <h4 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-muted-foreground">
                    {group.title}
                  </h4>
                )}
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                    const Icon = item.icon;

                    if (sidebarCollapsed) {
                      return (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>
                            <Link href={item.href}>
                              <Button
                                variant={isActive ? 'secondary' : 'ghost'}
                                size="icon"
                                className={cn('w-full text-slate-300 hover:text-white hover:bg-slate-800 dark:text-inherit dark:hover:text-inherit dark:hover:bg-accent', isActive && 'bg-slate-800 text-white dark:bg-secondary dark:text-secondary-foreground')}
                              >
                                <Icon className="h-5 w-5" />
                              </Button>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {item.title}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return (
                      <Link key={item.href} href={item.href}>
                        <Button
                          variant={isActive ? 'secondary' : 'ghost'}
                          className={cn(
                            'w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800 dark:text-inherit dark:hover:text-inherit dark:hover:bg-accent',
                            isActive && 'bg-slate-800 text-white dark:bg-secondary dark:text-secondary-foreground'
                          )}
                        >
                          <Icon className="mr-3 h-5 w-5" />
                          {item.title}
                          {item.badge && (
                            <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                              {item.badge}
                            </span>
                          )}
                        </Button>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
            })}
          </nav>
        </ScrollArea>

        {/* Collapse Toggle */}
        <div className="border-t border-slate-700 dark:border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-slate-400 hover:text-white hover:bg-slate-800 dark:text-inherit dark:hover:bg-accent"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Collapse
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
