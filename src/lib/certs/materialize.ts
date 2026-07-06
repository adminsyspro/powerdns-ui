import fs from 'fs';
import path from 'path';
import { getCertsDir, getCertsUid, getCertsGid } from './config';

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
  // O_EXCL: create a fresh regular file — never follow a pre-existing symlink at tmp.
  const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fchmodSync(fd, mode); // enforce mode regardless of umask at create time
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

const SHARED_DIR_MODE = 0o2750;      // setgid + rwxr-x---
const SHARED_PRIVKEY_MODE = 0o640;   // rw-r-----
const PUBLIC_MODE = 0o644;

const warnedKeys = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(msg);
}
function bestEffort(fn: () => void): void { try { fn(); } catch { /* ownership/mode is best-effort */ } }

/** Create/verify a group-shared managed dir. `isRoot` allows a symlinked CERTS_DIR (resolved). Returns the real path. */
function ensureSharedDir(dir: string, gid: number, uid: number | null, isRoot: boolean): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: SHARED_DIR_MODE });
  const st = fs.lstatSync(dir);
  let target = dir;
  if (st.isSymbolicLink()) {
    if (!isRoot) throw new Error(`refusing to write through symlinked cert dir: ${dir}`);
    target = fs.realpathSync(dir); // operator-controlled root may symlink to a mount
  } else if (!st.isDirectory()) {
    throw new Error(`cert path exists but is not a directory: ${dir}`);
  }
  bestEffort(() => fs.chownSync(target, uid ?? -1, gid)); // chown BEFORE chmod (chmod re-applies setgid)
  bestEffort(() => fs.chmodSync(target, SHARED_DIR_MODE));
  const v = fs.statSync(target);
  if (v.gid !== gid || (v.mode & 0o010) === 0) {
    warnOnce(`dir:${target}`, `[certs] export dir ${target} may be unusable by consumers: mode=${(v.mode & 0o7777).toString(8)} gid=${v.gid} (wanted gid=${gid}, group-exec).`);
  }
  return target;
}

/** Write privkey through an fd: 0600 → fchown → verify group → relax to 0640 only if verified. */
function writePrivkeyShared(filePath: string, data: string, gid: number, uid: number | null): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  let relaxed = false;
  try {
    fs.writeFileSync(fd, data);
    fs.fchmodSync(fd, 0o600);
    try {
      fs.fchownSync(fd, uid ?? -1, gid);
      if (fs.fstatSync(fd).gid === gid) { fs.fchmodSync(fd, SHARED_PRIVKEY_MODE); relaxed = true; }
    } catch { /* best-effort; leave 0600 */ }
    if (!relaxed) warnOnce(`key:${filePath}`, `[certs] ${filePath}: could not set group ${gid}; left 0600 (not group-readable).`);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/** Write the certbot-style file set for a cert; returns the live/<name> directory. */
export function materializeCert(opts: {
  name: string; leafPem: string; chainPem: string; privkeyPem: string; certsDir?: string;
}): string {
  const name = sanitizeCertName(opts.name);
  const root = opts.certsDir ?? getCertsDir();
  const fullchain = opts.chainPem ? `${opts.leafPem}${opts.chainPem}` : opts.leafPem;
  const gid = getCertsGid();

  if (gid === null) {
    // ---- legacy branch: byte-for-byte the pre-NFS behavior ----
    const live = path.join(root, 'live', name);
    fs.mkdirSync(live, { recursive: true, mode: 0o700 });
    writeFileAtomic(path.join(live, 'privkey.pem'), opts.privkeyPem, 0o600);
    writeFileAtomic(path.join(live, 'cert.pem'), opts.leafPem, 0o644);
    writeFileAtomic(path.join(live, 'chain.pem'), opts.chainPem, 0o644);
    writeFileAtomic(path.join(live, 'fullchain.pem'), fullchain, 0o644);
    return live;
  }

  // ---- shared branch: group-readable for NFS export ----
  const uid = getCertsUid();
  const rootResolved = ensureSharedDir(root, gid, uid, true);
  const liveParent = ensureSharedDir(path.join(rootResolved, 'live'), gid, uid, false);
  const live = ensureSharedDir(path.join(liveParent, name), gid, uid, false);

  writePrivkeyShared(path.join(live, 'privkey.pem'), opts.privkeyPem, gid, uid);
  const publics: Array<[string, string]> = [['cert.pem', opts.leafPem], ['chain.pem', opts.chainPem], ['fullchain.pem', fullchain]];
  for (const [file, data] of publics) {
    const p = path.join(live, file);
    writeFileAtomic(p, data, PUBLIC_MODE);
    bestEffort(() => fs.chownSync(p, uid ?? -1, gid));
  }
  return live;
}

/** Remove a certificate's materialized live/<name> directory (best-effort; caller should catch). */
export function removeMaterializedCert(name: string, certsDir?: string): void {
  const safeName = sanitizeCertName(name);
  const root = certsDir ?? getCertsDir();
  const live = path.join(root, 'live', safeName);
  fs.rmSync(live, { recursive: true, force: true });
}
