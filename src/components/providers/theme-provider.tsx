'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ThemeProviderProps } from 'next-themes/dist/types';
import { useUIPreferencesStore } from '@/stores';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const { themeColor } = useUIPreferencesStore();

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-blue', 'theme-green', 'theme-purple', 'theme-orange', 'theme-red', 'theme-teal', 'theme-slate', 'theme-rose');
    root.classList.add(`theme-${themeColor}`);
  }, [themeColor]);

  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
