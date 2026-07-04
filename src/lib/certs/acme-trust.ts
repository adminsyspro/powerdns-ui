import * as tls from 'node:tls';
import * as https from 'node:https';
import { X509Certificate } from 'node:crypto';
import * as acme from 'acme-client';
import { listTrustedRoots } from './store';

/** SHA-256 of the certificate DER, normalized to lowercase hex without colons. */
export function fingerprintSha256(pem: string): string {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
}

const CERT_RE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** Split a PEM bundle into its individual certificate blocks. */
export function splitPemCertificates(pem: string): string[] {
  return pem.match(CERT_RE) ?? [];
}

/**
 * Validate an operator-pasted root PEM: it must contain EXACTLY ONE certificate,
 * be a CA (basicConstraints CA:TRUE), and be currently valid. Returns the single
 * normalized cert PEM plus its DER SHA-256 fingerprint and notAfter (epoch seconds).
 */
export function parseSingleCaRoot(pem: string): { pem: string; fingerprint: string; notAfter: number } {
  const certs = splitPemCertificates(pem);
  if (certs.length !== 1) throw new Error(`expected exactly 1 certificate, got ${certs.length}`);
  const one = certs[0];
  const x = new X509Certificate(one);
  if (!x.ca) throw new Error('certificate is not a CA (basicConstraints CA:FALSE)');
  const notAfter = Math.floor(Date.parse(x.validTo) / 1000);
  if (!Number.isFinite(notAfter)) throw new Error('certificate has no valid notAfter');
  if (notAfter * 1000 < Date.now()) throw new Error('certificate is expired');
  return { pem: one, fingerprint: fingerprintSha256(one), notAfter };
}

/**
 * From a fetched roots bundle, return ONLY the single cert whose DER SHA-256
 * equals the pinned fingerprint — never the whole bundle (blocks root injection).
 */
export function selectCertFromBundleByFingerprint(pemBundle: string, pin: string): string | null {
  const want = pin.replace(/:/g, '').toLowerCase();
  for (const cert of splitPemCertificates(pemBundle)) {
    if (fingerprintSha256(cert) === want) return cert;
  }
  return null;
}

/** Origin (scheme://host:port). Non-default ports are preserved — the trust key. */
export function originOf(url: string): string {
  return new URL(url).origin;
}

/** Group pinned roots by the origin of each account's directory URL. */
export function buildOriginRootMap(
  entries: { directoryUrl: string; rootPem: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { directoryUrl, rootPem } of entries) {
    let origin: string;
    try { origin = originOf(directoryUrl); } catch { continue; }
    const arr = map.get(origin);
    if (arr) arr.push(rootPem);
    else map.set(origin, [rootPem]);
  }
  return map;
}

// --- interceptor wiring (impure, process-global) ---
let originToAgent = new Map<string, https.Agent>();
let interceptorInstalled = false;

/** Rebuild the per-origin HTTPS agents from the given pinned roots; destroy old ones. */
export function setTrustRoots(entries: { directoryUrl: string; rootPem: string }[]): void {
  const next = new Map<string, https.Agent>();
  for (const [origin, roots] of buildOriginRootMap(entries)) {
    next.set(origin, new https.Agent({ ca: [...tls.rootCertificates, ...roots], keepAlive: false }));
  }
  const old = originToAgent;
  originToAgent = next;
  for (const agent of old.values()) agent.destroy();
}

/** The agent for a URL's origin, or undefined to use axios' default (public roots only). */
export function pickAgentForUrl(url: string): https.Agent | undefined {
  try { return originToAgent.get(originOf(url)); } catch { return undefined; }
}

/** Apply per-origin trust and disable HTTP redirects on an axios request config. */
export function applyTrust<T extends { url?: string; httpsAgent?: unknown; maxRedirects?: number }>(config: T): T {
  config.maxRedirects = 0; // ACME needs no redirects; blocks cross-origin agent reuse
  const agent = config.url ? pickAgentForUrl(config.url) : undefined;
  if (agent) config.httpsAgent = agent;
  return config;
}

/** Register the singleton request interceptor on acme-client's shared axios instance. */
export function installTrustInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  acme.axios.interceptors.request.use((config) => applyTrust(config));
}

/** Install the interceptor (once) and reload pinned roots from the DB. Call before register/issue. */
export function reloadAcmeTrust(): void {
  installTrustInterceptor();
  setTrustRoots(listTrustedRoots());
}
