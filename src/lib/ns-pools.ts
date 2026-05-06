export interface NameserverPool {
  id: string;
  name: string;
  nameservers: string[];
  isDefault?: boolean;
}

export function normalizeNameserver(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

export function normalizeNameserverPool(pool: Partial<NameserverPool>, fallbackId: string): NameserverPool | null {
  const name = typeof pool.name === 'string' ? pool.name.trim() : '';
  const rawNameservers = Array.isArray(pool.nameservers) ? pool.nameservers : [];
  const nameservers = Array.from(
    new Set(
      rawNameservers
        .filter((ns): ns is string => typeof ns === 'string')
        .map(normalizeNameserver)
        .filter(Boolean)
    )
  );

  if (!name || nameservers.length === 0) return null;

  return {
    id: typeof pool.id === 'string' && pool.id.trim() ? pool.id : fallbackId,
    name,
    nameservers,
    isDefault: !!pool.isDefault,
  };
}

export function normalizeNameserverPools(input: unknown): NameserverPool[] {
  if (!Array.isArray(input)) return [];

  const pools = input
    .map((pool, index) =>
      typeof pool === 'object' && pool !== null
        ? normalizeNameserverPool(pool as Partial<NameserverPool>, `ns-pool-${index + 1}`)
        : null
    )
    .filter((pool): pool is NameserverPool => !!pool);

  const defaultIndex = pools.findIndex((pool) => pool.isDefault);
  return pools.map((pool, index) => ({
    ...pool,
    isDefault: defaultIndex === -1 ? index === 0 : index === defaultIndex,
  }));
}

export function getDefaultNameserverPool(pools: NameserverPool[]): NameserverPool | undefined {
  return pools.find((pool) => pool.isDefault) || pools[0];
}
