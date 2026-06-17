'use client';

import * as React from 'react';
import { usePageTitleStore } from '@/stores';

/** Publishes the current page's title to the header. Renders nothing. */
export function PageTitle({ title }: { title: string }) {
  const setTitle = usePageTitleStore((s) => s.setTitle);
  React.useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);
  return null;
}
