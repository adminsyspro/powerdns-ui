import { create } from 'zustand';

interface PageTitleState {
  title: string;
  setTitle: (title: string) => void;
}

/** Current page title, published by <PageTitle> and rendered in the header. */
export const usePageTitleStore = create<PageTitleState>((set) => ({
  title: '',
  setTitle: (title) => set({ title }),
}));
