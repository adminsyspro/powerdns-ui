import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Zone,
  ZoneListItem,
  Server,
  ServerConnection,
  User,
  ZoneTemplate,
  ActivityLog,
} from '@/types/powerdns';

// Server Connection Store
interface ServerConnectionStore {
  connections: ServerConnection[];
  activeConnection: ServerConnection | null;
  addConnection: (connection: Omit<ServerConnection, 'id'>) => void;
  updateConnection: (id: string, connection: Partial<ServerConnection>) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  getDefaultConnection: () => ServerConnection | null;
}

export const useServerConnectionStore = create<ServerConnectionStore>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnection: null,
      addConnection: (connection) => {
        const newConnection: ServerConnection = {
          ...connection,
          id: crypto.randomUUID(),
        };
        set((state) => ({
          connections: [...state.connections, newConnection],
          activeConnection: state.activeConnection || newConnection,
        }));
      },
      updateConnection: (id, connection) => {
        set((state) => ({
          connections: state.connections.map((c) =>
            c.id === id ? { ...c, ...connection } : c
          ),
          activeConnection:
            state.activeConnection?.id === id
              ? { ...state.activeConnection, ...connection }
              : state.activeConnection,
        }));
      },
      removeConnection: (id) => {
        set((state) => {
          const connections = state.connections.filter((c) => c.id !== id);
          return {
            connections,
            activeConnection:
              state.activeConnection?.id === id
                ? connections[0] || null
                : state.activeConnection,
          };
        });
      },
      setActiveConnection: (id) => {
        set((state) => ({
          activeConnection: state.connections.find((c) => c.id === id) || null,
        }));
      },
      getDefaultConnection: () => {
        const state = get();
        return state.connections.find((c) => c.isDefault) || state.connections[0] || null;
      },
    }),
    {
      name: 'pdns-server-connections',
    }
  )
);

// Zones Store
interface ZonesStore {
  zones: ZoneListItem[];
  selectedZone: Zone | null;
  isLoading: boolean;
  error: string | null;
  setZones: (zones: ZoneListItem[]) => void;
  setSelectedZone: (zone: Zone | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  addZone: (zone: ZoneListItem) => void;
  updateZone: (id: string, zone: Partial<ZoneListItem>) => void;
  removeZone: (id: string) => void;
}

export const useZonesStore = create<ZonesStore>((set) => ({
  zones: [],
  selectedZone: null,
  isLoading: false,
  error: null,
  setZones: (zones) => set({ zones }),
  setSelectedZone: (zone) => set({ selectedZone: zone }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  addZone: (zone) => set((state) => ({ zones: [...state.zones, zone] })),
  updateZone: (id, zone) =>
    set((state) => ({
      zones: state.zones.map((z) => (z.id === id ? { ...z, ...zone } : z)),
    })),
  removeZone: (id) =>
    set((state) => ({
      zones: state.zones.filter((z) => z.id !== id),
    })),
}));

// Server Info Store
interface ServerStore {
  server: Server | null;
  statistics: Record<string, string>;
  config: Record<string, string>;
  isLoading: boolean;
  setServer: (server: Server | null) => void;
  setStatistics: (stats: Record<string, string>) => void;
  setConfig: (config: Record<string, string>) => void;
  setLoading: (loading: boolean) => void;
}

export const useServerStore = create<ServerStore>((set) => ({
  server: null,
  statistics: {},
  config: {},
  isLoading: false,
  setServer: (server) => set({ server }),
  setStatistics: (statistics) => set({ statistics }),
  setConfig: (config) => set({ config }),
  setLoading: (isLoading) => set({ isLoading }),
}));

// User & Auth Store
interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      token: null,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setToken: (token) => set({ token }),
      login: (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'pdns-auth',
    }
  )
);

// Zone Templates Store
interface TemplatesStore {
  templates: ZoneTemplate[];
  addTemplate: (template: Omit<ZoneTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTemplate: (id: string, template: Partial<ZoneTemplate>) => void;
  removeTemplate: (id: string) => void;
  getTemplate: (id: string) => ZoneTemplate | undefined;
}

export const useTemplatesStore = create<TemplatesStore>()(
  persist(
    (set, get) => ({
      templates: [
        {
          id: 'default',
          name: 'Default Zone',
          description: 'Standard zone template with basic records',
          records: [
            { name: '@', type: 'NS', content: 'ns1.example.com.', ttl: 86400 },
            { name: '@', type: 'NS', content: 'ns2.example.com.', ttl: 86400 },
            { name: '@', type: 'A', content: '192.168.1.1', ttl: 3600 },
            { name: 'www', type: 'A', content: '192.168.1.1', ttl: 3600 },
            { name: '@', type: 'MX', content: 'mail.example.com.', ttl: 3600, priority: 10 },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'web-hosting',
          name: 'Web Hosting',
          description: 'Template for web hosting with common records',
          records: [
            { name: '@', type: 'NS', content: 'ns1.example.com.', ttl: 86400 },
            { name: '@', type: 'NS', content: 'ns2.example.com.', ttl: 86400 },
            { name: '@', type: 'A', content: '192.168.1.1', ttl: 3600 },
            { name: 'www', type: 'CNAME', content: '@', ttl: 3600 },
            { name: '@', type: 'MX', content: 'mail.example.com.', ttl: 3600, priority: 10 },
            { name: '@', type: 'TXT', content: '"v=spf1 mx ~all"', ttl: 3600 },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      addTemplate: (template) => {
        const newTemplate: ZoneTemplate = {
          ...template,
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set((state) => ({ templates: [...state.templates, newTemplate] }));
      },
      updateTemplate: (id, template) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, ...template, updatedAt: new Date() } : t
          ),
        }));
      },
      removeTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }));
      },
      getTemplate: (id) => get().templates.find((t) => t.id === id),
    }),
    {
      name: 'pdns-templates',
    }
  )
);

// Activity Log Store
interface ActivityLogStore {
  logs: ActivityLog[];
  addLog: (log: Omit<ActivityLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  getRecentLogs: (limit?: number) => ActivityLog[];
}

export const useActivityLogStore = create<ActivityLogStore>()(
  persist(
    (set, get) => ({
      logs: [],
      addLog: (log) => {
        const newLog: ActivityLog = {
          ...log,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        };
        set((state) => ({
          logs: [newLog, ...state.logs].slice(0, 1000), // Keep last 1000 logs
        }));
      },
      clearLogs: () => set({ logs: [] }),
      getRecentLogs: (limit = 10) => get().logs.slice(0, limit),
    }),
    {
      name: 'pdns-activity-logs',
    }
  )
);

// UI Preferences Store
export type ThemeColor = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'teal' | 'slate' | 'rose';

interface UIPreferencesStore {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  themeColor: ThemeColor;
  recordsPerPage: number;
  zonesPerPage: number;
  showDisabledRecords: boolean;
  confirmDeletion: boolean;
  compactMode: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setThemeColor: (color: ThemeColor) => void;
  setRecordsPerPage: (count: number) => void;
  setZonesPerPage: (count: number) => void;
  setShowDisabledRecords: (show: boolean) => void;
  setConfirmDeletion: (confirm: boolean) => void;
  setCompactMode: (compact: boolean) => void;
}

export const useUIPreferencesStore = create<UIPreferencesStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'system',
      themeColor: 'blue',
      recordsPerPage: 25,
      zonesPerPage: 25,
      showDisabledRecords: true,
      confirmDeletion: true,
      compactMode: true,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setTheme: (theme) => set({ theme }),
      setThemeColor: (themeColor) => set({ themeColor }),
      setRecordsPerPage: (recordsPerPage) => set({ recordsPerPage }),
      setZonesPerPage: (zonesPerPage) => set({ zonesPerPage }),
      setShowDisabledRecords: (showDisabledRecords) => set({ showDisabledRecords }),
      setConfirmDeletion: (confirmDeletion) => set({ confirmDeletion }),
      setCompactMode: (compactMode) => set({ compactMode }),
    }),
    {
      name: 'pdns-ui-preferences',
    }
  )
);

// Re-export pending changes store
export { usePendingChangesStore } from './pending-changes';
