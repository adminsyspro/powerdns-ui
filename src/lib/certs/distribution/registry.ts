import type { DistributionProvider, ProviderType } from './types';
import { filesystemProvider } from './providers/filesystem';
import { infisicalSecretsProvider } from './providers/infisical-secrets';

const PROVIDERS: Record<ProviderType, DistributionProvider> = {
  filesystem: filesystemProvider,
  'infisical-secrets': infisicalSecretsProvider,
};

export function getProvider(type: string): DistributionProvider {
  const p = PROVIDERS[type as ProviderType];
  if (!p) throw new Error(`unknown distribution provider: ${type}`);
  return p;
}

export function listProviders(): DistributionProvider[] {
  return Object.values(PROVIDERS);
}
