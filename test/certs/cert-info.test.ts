import assert from 'node:assert';
import { splitPemChain, parseCertInfo } from '../../src/lib/certs/cert-info';

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBizCCATGgAwIBAgIUHZTYx01peqo2NePPtE93JJzhzR0wCgYIKoZIzj0EAwIw
GzEZMBcGA1UEAwwQdGVzdC5leGFtcGxlLmNvbTAeFw0yNjA3MDIxODA4MjJaFw0z
NjA2MjkxODA4MjJaMBsxGTAXBgNVBAMMEHRlc3QuZXhhbXBsZS5jb20wWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAATzGMHVMHD9s1dlmxD9IoGKuFC9c4wm9whAT4iQ
7YHZPqHuWCju+aYdcisnu6c44+/FJltVrr2H0UHOuJmYeYH4o1MwUTAdBgNVHQ4E
FgQUMKZ9bM0VrE6Lf0sOztnqfi0FzjUwHwYDVR0jBBgwFoAUMKZ9bM0VrE6Lf0sO
ztnqfi0FzjUwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiAtpcge
qSGCp69jpBKnNwMDm20UG0dOR+8Ee5CRBy28YwIhANfdSB28eo5ya6tPcBoQh/GK
WwVvGS4ML/h9afpV4eN2
-----END CERTIFICATE-----`;

// splitPemChain: leaf + chain
const fake = `-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n`;
const split = splitPemChain(fake);
assert.ok(split.leaf.includes('AAAA') && !split.leaf.includes('BBBB'), 'leaf is first block');
assert.ok(split.chain.includes('BBBB') && !split.chain.includes('AAAA'), 'chain is remaining blocks');
assert.equal(splitPemChain(`-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n`).chain, '', 'single block → empty chain');

// parseCertInfo on the real self-signed cert
const info = parseCertInfo(TEST_CERT);
assert.ok(info.notAfter > info.notBefore, 'notAfter after notBefore');
assert.ok(info.notAfter > Math.floor(Date.now() / 1000), 'not yet expired (10y cert)');
assert.ok(info.serial && info.serial.length > 0, 'has serial');
assert.match(info.fingerprintSha256, /^[0-9a-f:]+$/i, 'sha256 fingerprint hex');
assert.match(info.subject, /test\.example\.com/i, 'subject CN');
assert.match(info.issuer, /test\.example\.com/i, 'self-signed issuer == subject');

console.log('certs/cert-info: ALL PASSED');
