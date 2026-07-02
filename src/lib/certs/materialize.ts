import fs from 'fs';
import path from 'path';
import { getCertsDir } from './config';

const NAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const MAX_NAME = 128;

export function sanitizeCertName(name: string): string {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n || n.length > MAX_NAME) throw new Error(`invalid certificate name: length`);
  if (n === '.' || n === '..' || n.startsWith('.')) throw new Error('invalid certificate name: dot');
  if (!NAME_RE.test(n)) throw new Error(`invalid certificate name: ${name}`);
  return n;
}

function writeFileAtomic(filePath: string, data: string, mode: number): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data, { mode });
  fs.chmodSync(tmp, mode); // ensure mode even if umask affected create
  fs.renameSync(tmp, filePath);
}

/** Write the certbot-style file set for a cert; returns the live/<name> directory. */
export function materializeCert(opts: {
  name: string; leafPem: string; chainPem: string; privkeyPem: string; certsDir?: string;
}): string {
  const name = sanitizeCertName(opts.name);
  const root = opts.certsDir ?? getCertsDir();
  const live = path.join(root, 'live', name);
  fs.mkdirSync(live, { recursive: true, mode: 0o700 });
  const fullchain = opts.chainPem ? `${opts.leafPem}${opts.chainPem}` : opts.leafPem;
  writeFileAtomic(path.join(live, 'privkey.pem'), opts.privkeyPem, 0o600);
  writeFileAtomic(path.join(live, 'cert.pem'), opts.leafPem, 0o644);
  writeFileAtomic(path.join(live, 'chain.pem'), opts.chainPem, 0o644);
  writeFileAtomic(path.join(live, 'fullchain.pem'), fullchain, 0o644);
  return live;
}

/** Remove a certificate's materialized live/<name> directory (best-effort; caller should catch). */
export function removeMaterializedCert(name: string, certsDir?: string): void {
  const safeName = sanitizeCertName(name);
  const root = certsDir ?? getCertsDir();
  const live = path.join(root, 'live', safeName);
  fs.rmSync(live, { recursive: true, force: true });
}
