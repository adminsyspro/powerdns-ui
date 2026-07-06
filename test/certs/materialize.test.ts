import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sanitizeCertName, materializeCert } from '../../src/lib/certs/materialize';

// name sanitization
assert.equal(sanitizeCertName('Web-Prod_1.example'), 'web-prod_1.example', 'lowercased, allowed chars kept');
assert.throws(() => sanitizeCertName('../etc/passwd'), /invalid/i, 'rejects traversal');
assert.throws(() => sanitizeCertName('a/b'), /invalid/i, 'rejects slash');
assert.throws(() => sanitizeCertName('.hidden'), /invalid/i, 'rejects leading dot');
assert.throws(() => sanitizeCertName(''), /invalid/i, 'rejects empty');
assert.throws(() => sanitizeCertName('a'.repeat(200)), /invalid/i, 'rejects overlong');

// materialization into a temp CERTS_DIR
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-mat-'));
const live = materializeCert({
  name: 'web', leafPem: 'LEAF\n', chainPem: 'CHAIN\n', privkeyPem: 'KEY\n', certsDir: dir,
});
assert.equal(live, path.join(dir, 'live', 'web'), 'returns live/<name> dir');
assert.equal(fs.readFileSync(path.join(live, 'privkey.pem'), 'utf8'), 'KEY\n', 'privkey written');
assert.equal(fs.readFileSync(path.join(live, 'cert.pem'), 'utf8'), 'LEAF\n', 'cert written');
assert.equal(fs.readFileSync(path.join(live, 'chain.pem'), 'utf8'), 'CHAIN\n', 'chain written');
assert.equal(fs.readFileSync(path.join(live, 'fullchain.pem'), 'utf8'), 'LEAF\nCHAIN\n', 'fullchain = leaf+chain');
// privkey mode 0600
const mode = fs.statSync(path.join(live, 'privkey.pem')).mode & 0o777;
assert.equal(mode, 0o600, 'privkey is 0600');
// re-materialize (renewal) overwrites cleanly
materializeCert({ name: 'web', leafPem: 'LEAF2\n', chainPem: '', privkeyPem: 'KEY2\n', certsDir: dir });
assert.equal(fs.readFileSync(path.join(live, 'fullchain.pem'), 'utf8'), 'LEAF2\n', 'renewal overwrites; empty chain → fullchain=leaf');
fs.rmSync(dir, { recursive: true, force: true });

// --- Task 2: writeFileAtomic uses O_EXCL (no symlink follow on the temp file) ---
{
  const realOpen = fs.openSync;
  const seenFlags: number[] = [];
  (fs as any).openSync = (p: string, flags: number, mode?: number) => {
    seenFlags.push(flags);
    return (realOpen as any)(p, flags, mode);
  };
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-oexcl-'));
    materializeCert({ name: 'web', leafPem: 'L\n', chainPem: 'C\n', privkeyPem: 'K\n', certsDir: d });
    assert.ok(seenFlags.length >= 4, 'openSync used for each written file');
    assert.ok(seenFlags.every((f) => (f & fs.constants.O_EXCL) !== 0), 'every temp open uses O_EXCL');
    fs.rmSync(d, { recursive: true, force: true });
  } finally {
    (fs as any).openSync = realOpen;
  }
}

// --- Task 3: shared-mode (CERTS_GID) materialization ---
function statMode(p: string): number { return fs.statSync(p).mode & 0o7777; }

// (a) shared success: gid = own gid so chown to own group succeeds unprivileged (and as root too)
{
  const gid = process.getgid!();
  process.env.CERTS_GID = String(gid);
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-shared-'));
    const live = materializeCert({ name: 'web', leafPem: 'L\n', chainPem: 'C\n', privkeyPem: 'K\n', certsDir: d });
    assert.equal(statMode(path.join(live, 'privkey.pem')), 0o640, 'shared: privkey relaxed to 0640');
    assert.equal(statMode(path.join(live, 'fullchain.pem')), 0o644, 'shared: public 0644');
    assert.equal(statMode(d) & 0o2750, 0o2750, 'shared: root dir is setgid 02750');
    assert.equal(statMode(path.join(d, 'live')) & 0o2750, 0o2750, 'shared: live dir 02750');
    assert.equal(statMode(live) & 0o2750, 0o2750, 'shared: name dir 02750');
    assert.equal(fs.statSync(path.join(live, 'privkey.pem')).gid, gid, 'shared: privkey group set');
    assert.equal(fs.statSync(live).gid, gid, 'shared: name dir group set');
    fs.rmSync(d, { recursive: true, force: true });
  } finally { delete process.env.CERTS_GID; }
}

// (b) legacy unchanged: no CERTS_GID → 0700/0600/0644, and no chown is ever called
{
  const realChown = fs.chownSync; const realFchown = fs.fchownSync;
  let chownCalls = 0;
  (fs as any).chownSync = (...a: unknown[]) => { chownCalls++; return (realChown as any)(...a); };
  (fs as any).fchownSync = (...a: unknown[]) => { chownCalls++; return (realFchown as any)(...a); };
  try {
    delete process.env.CERTS_GID;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-legacy-'));
    const live = materializeCert({ name: 'web', leafPem: 'L\n', chainPem: 'C\n', privkeyPem: 'K\n', certsDir: d });
    assert.equal(statMode(path.join(live, 'privkey.pem')), 0o600, 'legacy: privkey 0600');
    assert.equal(statMode(live), 0o700, 'legacy: name dir 0700');
    assert.equal(chownCalls, 0, 'legacy: no chown calls');
    fs.rmSync(d, { recursive: true, force: true });
  } finally {
    (fs as any).chownSync = realChown;
    (fs as any).fchownSync = realFchown;
  }
}

// (c) chown-failure resilience: fchown throws → privkey stays 0600 (never 0640), no throw, warns
{
  const realFchown = fs.fchownSync;
  (fs as any).fchownSync = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
  const warns: string[] = []; const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
  process.env.CERTS_GID = String(process.getgid!());
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-chownfail-'));
    const live = materializeCert({ name: 'web', leafPem: 'L\n', chainPem: 'C\n', privkeyPem: 'K\n', certsDir: d });
    assert.equal(statMode(path.join(live, 'privkey.pem')), 0o600, 'chown-fail: privkey stays 0600');
    assert.ok(warns.some((m) => /left 0600|could not set group/.test(m)), 'chown-fail: warns');
    fs.rmSync(d, { recursive: true, force: true });
  } finally {
    delete process.env.CERTS_GID; console.warn = origWarn;
    (fs as any).fchownSync = realFchown;
  }
}

// (d) symlink policy: root symlink accepted (resolved); managed live/<name> symlink refused
{
  process.env.CERTS_GID = String(process.getgid!());
  try {
    // root symlink → real dir: accepted
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-realroot-'));
    const linkRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'certs-linkbase-')), 'root-link');
    fs.symlinkSync(realRoot, linkRoot);
    materializeCert({ name: 'web', leafPem: 'L\n', chainPem: '', privkeyPem: 'K\n', certsDir: linkRoot });
    assert.ok(fs.existsSync(path.join(realRoot, 'live', 'web', 'privkey.pem')), 'root symlink resolved, files under real root');

    // managed name dir is a symlink: refused
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-symdir-'));
    fs.mkdirSync(path.join(d2, 'live'), { recursive: true });
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-decoy-'));
    fs.symlinkSync(decoy, path.join(d2, 'live', 'web'));
    assert.throws(
      () => materializeCert({ name: 'web', leafPem: 'L\n', chainPem: '', privkeyPem: 'K\n', certsDir: d2 }),
      /symlink|refus/i,
      'symlinked managed dir refused',
    );

    fs.rmSync(realRoot, { recursive: true, force: true });
    fs.rmSync(d2, { recursive: true, force: true });
    fs.rmSync(decoy, { recursive: true, force: true });
  } finally { delete process.env.CERTS_GID; }
}

// (e) unusable-export warning: dir group cannot be set → warn (stub chownSync no-op so gid stays mismatched)
{
  const realChown = fs.chownSync;
  (fs as any).chownSync = () => {}; // no-op: dir gid stays the process's own gid, != configured
  const warns: string[] = []; const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
  process.env.CERTS_GID = String(process.getgid!() + 1); // a gid the dir won't have (chown stubbed)
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-unusable-'));
    materializeCert({ name: 'web', leafPem: 'L\n', chainPem: '', privkeyPem: 'K\n', certsDir: d });
    assert.ok(warns.some((m) => /unusable/i.test(m)), 'warns that export dir may be unusable');
    fs.rmSync(d, { recursive: true, force: true });
  } finally {
    delete process.env.CERTS_GID; console.warn = origWarn;
    (fs as any).chownSync = realChown;
  }
}

console.log('certs/materialize: ALL PASSED');
