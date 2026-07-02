export type CaType = 'letsencrypt' | 'step-ca' | 'other';
export type PropagationMode = 'authoritative' | 'resolver' | 'delay';
export type AcmeAccountStatus = 'unregistered' | 'registered' | 'error';

/** ACME account as returned by the API/store — NEVER includes secrets. */
export interface AcmeAccount {
  id: string;
  name: string;
  caType: CaType;
  directoryUrl: string;
  contactEmail: string;
  eabKid: string | null;
  hasEabHmac: boolean;      // presence flag only; the value is never exposed
  hasAccountKey: boolean;   // presence flag only
  accountUrl: string | null;
  tosAgreed: boolean;
  tosAgreedAt: number | null;
  rootFingerprintSha256: string | null;
  propagationMode: PropagationMode;
  propagationResolver: string | null;
  status: AcmeAccountStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AcmeAccountInput {
  name: string;
  caType: CaType;
  directoryUrl: string;
  contactEmail?: string;
  eabKid?: string | null;
  eabHmacKey?: string | null;          // plaintext in; stored encrypted
  rootPem?: string | null;             // step-ca trust (Phase 5 uses it)
  rootFingerprintSha256?: string | null;
  propagationMode?: PropagationMode;
  propagationResolver?: string | null;
  tosAgreed?: boolean;
}

export interface AcmeAccountPatch {
  name?: string;
  contactEmail?: string;
  directoryUrl?: string;
  eabKid?: string | null;
  eabHmacKey?: string | null;
  rootPem?: string | null;
  rootFingerprintSha256?: string | null;
  propagationMode?: PropagationMode;
  propagationResolver?: string | null;
  tosAgreed?: boolean;
}

/** Decrypted secrets for an account — only from getAccountSecrets(), used by Phase 3. */
export interface AcmeAccountSecrets {
  accountKeyPem: string | null;
  eabHmacKey: string | null;
}
