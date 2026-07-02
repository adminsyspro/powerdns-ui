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

console.log('certs/materialize: ALL PASSED');
