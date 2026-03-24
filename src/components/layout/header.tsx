'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import {
  Bell,
  Moon,
  Sun,
  Search,
  User,
  LogOut,
  Settings,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useServerConnectionStore, useAuthStore } from '@/stores';

export function Header() {
  const { theme, setTheme } = useTheme();
  const { connections, activeConnection, setActiveConnection } = useServerConnectionStore();
  const { user, logout } = useAuthStore();
  const [searchQuery, setSearchQuery] = React.useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(searchQuery)}`;
    }
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-700 dark:border-border bg-slate-900 text-slate-100 dark:bg-background dark:text-foreground px-6">
      {/* Left: Server Selector */}
      <div className="flex items-center gap-4">
        {connections.length > 0 && (
          <Select
            value={activeConnection?.id || ''}
            onValueChange={setActiveConnection}
          >
            <SelectTrigger className="w-[220px] border-slate-600 bg-slate-800 text-slate-100 dark:border-input dark:bg-background dark:text-foreground">
              <Server className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select server" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  {conn.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-4">

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-300 hover:text-white hover:bg-slate-800 dark:text-inherit dark:hover:bg-accent"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full hover:bg-slate-800 dark:hover:bg-accent">
              <Avatar>
                <AvatarImage src="/avatars/default.png" alt={user?.username || 'User'} />
                <AvatarFallback className="bg-slate-700 text-slate-100 dark:bg-muted dark:text-muted-foreground">
                  {user?.username?.slice(0, 2).toUpperCase() || 'AD'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user?.firstname} {user?.lastname}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email || 'admin@example.com'}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
