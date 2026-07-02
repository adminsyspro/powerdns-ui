import { X509Certificate } from 'crypto';

/** Split a full-chain PEM into the leaf (first cert) and the remaining chain. */
export function splitPemChain(fullchain: string): { leaf: string; chain: string } {
  const blocks = fullchain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0) throw new Error('splitPemChain: no PEM certificate blocks found');
  const leaf = blocks[0]!.trim() + '\n';
  const chain = blocks.slice(1).map((b) => b.trim()).join('\n');
  return { leaf, chain: chain ? chain + '\n' : '' };
}

/** Parse leaf-cert metadata via Node's built-in X.509 parser. */
export function parseCertInfo(leafPem: string): {
  notBefore: number; notAfter: number; serial: string;
  fingerprintSha256: string; issuer: string; subject: string;
} {
  const x = new X509Certificate(leafPem);
  return {
    notBefore: Math.floor(new Date(x.validFrom).getTime() / 1000),
    notAfter: Math.floor(new Date(x.validTo).getTime() / 1000),
    serial: x.serialNumber,
    fingerprintSha256: x.fingerprint256,
    issuer: x.issuer,
    subject: x.subject,
  };
}
