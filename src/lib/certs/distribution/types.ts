/**
 * Certificate distribution layer.
 *
 * PowerDNS-UI is the single issuer. Once a certificate is issued, it is
 * *distributed* to one or more destinations through pluggable providers
 * (filesystem/NFS, Infisical secrets, …). Each (certificate × connection ×
 * target) is a `CertificateDistribution` row carrying its own publish state, so
 * a reconciler can republish on renewal, retry on failure and move the material
 * when the target changes.
 */

export type ProviderType = 'filesystem' | 'infisical-secrets';
export const PROVIDER_TYPES: readonly ProviderType[] = ['filesystem', 'infisical-secrets'];

/** Everything a provider may publish. Built from the cert store at publish time, never persisted here. */
export interface CertMaterial {
  certificateId: string;
  name: string;
  category: string | null;
  leafPem: string;
  /** Issuer chain without the leaf; '' when the CA returned none. Providers build their own fullchain
   * so each keeps its historical byte format. */
  chainPem: string;
  privkeyPem: string;
  fingerprintSha256: string;
  notAfter: number | null;
}

/** Provider-specific, non-secret connection settings (JSON). */
export type ConnectionConfig = Record<string, unknown>;
/** Provider-specific target, possibly with `{name}` / `{category}` placeholders (JSON). */
export type TargetSpec = Record<string, unknown>;
/** Fully resolved target as actually written — what `unpublish` needs to remove it. */
export type ResolvedTarget = Record<string, unknown>;

export interface ProviderContext {
  connectionId: string;
  /** Monotonic marker of the connection settings (e.g. updated_at) — lets providers cache auth safely. */
  connectionVersion: number;
  config: ConnectionConfig;
  /** Decrypted secret (e.g. Infisical client secret). Never logged, never returned by the API. */
  secret: string | null;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

export interface DistributionProvider {
  type: ProviderType;
  label: string;
  /** Whether a connection of this type needs a secret. */
  needsSecret: boolean;
  /** Validate + normalize connection settings; throws a user-facing Error on invalid input. */
  normalizeConfig(input: unknown): ConnectionConfig;
  /** Validate + normalize a target spec; throws a user-facing Error on invalid input. */
  normalizeTarget(input: unknown): TargetSpec;
  /** Resolve placeholders for a given certificate. Pure; used to detect target moves. */
  resolveTarget(target: TargetSpec, cert: { name: string; category: string | null }, config: ConnectionConfig): ResolvedTarget;
  /** Idempotently write the material to the resolved target. */
  publish(ctx: ProviderContext, target: ResolvedTarget, material: CertMaterial): Promise<void>;
  /** Remove what `publish` wrote at that resolved target. Missing data is not an error. */
  unpublish(ctx: ProviderContext, target: ResolvedTarget, cert: { name: string }): Promise<void>;
  /** Read-only connectivity/permission check, optionally against a resolved target. */
  test(ctx: ProviderContext, target?: ResolvedTarget): Promise<TestResult>;
}

/** Public shape of a connection — never includes the secret. */
export interface DistributionConnection {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  config: ConnectionConfig;
  hasSecret: boolean;
  /** When true, every certificate gets a distribution to `defaultTarget` (marked origin='auto'). */
  autoAttach: boolean;
  defaultTarget: TargetSpec | null;
  createdAt: number;
  updatedAt: number;
}

export type DistributionStatus = 'pending' | 'published' | 'error' | 'disabled';

export interface CertificateDistribution {
  id: string;
  certificateId: string;
  connectionId: string;
  connectionName: string;
  providerType: ProviderType;
  origin: 'auto' | 'manual';
  target: TargetSpec;
  /** Target resolved for the certificate as it is now (name/category). */
  resolvedTarget: ResolvedTarget;
  /** Where the material was last written, or null if never. */
  publishedTarget: ResolvedTarget | null;
  publishedFingerprint: string | null;
  publishedAt: number | null;
  lastError: string | null;
  lastAttemptAt: number | null;
  attempts: number;
  nextAttemptAt: number | null;
  status: DistributionStatus;
  createdAt: number;
}
