import assert from 'node:assert';
import { createHash, X509Certificate } from 'node:crypto';
import * as acme from 'acme-client';
import {
  fingerprintSha256, splitPemCertificates, parseSingleCaRoot,
  selectCertFromBundleByFingerprint, originOf, buildOriginRootMap,
  setTrustRoots, pickAgentForUrl, applyTrust, installTrustInterceptor,
} from '../../src/lib/certs/acme-trust';
import { ROOT_A_PEM, ROOT_B_PEM, LEAF_PEM } from './fixtures/trust-certs';

const STEP_CA_DIR = 'https://step-ca:9000/acme/acme/directory';
const LE_DIR = 'https://acme-v02.api.letsencrypt.org/directory';

// fingerprint = DER SHA-256, normalized — cross-checked against an independent DER hash
const independent = createHash('sha256').update(new X509Certificate(ROOT_A_PEM).raw).digest('hex');
assert.equal(fingerprintSha256(ROOT_A_PEM), independent, 'fingerprint == DER SHA-256 (normalized)');
assert.ok(/^[0-9a-f]{64}$/.test(fingerprintSha256(ROOT_A_PEM)), 'lowercase hex, no colons');

// splitting a bundle
const bundle = ROOT_A_PEM + ROOT_B_PEM;
assert.equal(splitPemCertificates(bundle).length, 2, 'bundle splits into 2 certs');

// parseSingleCaRoot: accepts one CA, rejects bundle + non-CA
const parsed = parseSingleCaRoot(ROOT_A_PEM);
assert.equal(parsed.fingerprint, fingerprintSha256(ROOT_A_PEM), 'parsed fingerprint');
assert.ok(parsed.notAfter > Math.floor(Date.now() / 1000), 'notAfter in the future');
assert.throws(() => parseSingleCaRoot(bundle), /exactly 1 certificate/, 'rejects multi-cert bundle');
assert.throws(() => parseSingleCaRoot(LEAF_PEM), /not a CA/, 'rejects non-CA cert');

// bundle-injection defense: pin on ROOT_A returns ONLY ROOT_A from [ROOT_A, ROOT_B]
const picked = selectCertFromBundleByFingerprint(bundle, fingerprintSha256(ROOT_A_PEM));
assert.ok(picked && fingerprintSha256(picked) === fingerprintSha256(ROOT_A_PEM), 'picks pinned cert');
assert.ok(picked && fingerprintSha256(picked) !== fingerprintSha256(ROOT_B_PEM), 'not the rogue cert');
assert.equal(selectCertFromBundleByFingerprint(bundle, 'deadbeef'), null, 'unknown pin => null');

// origin key includes the port
assert.equal(originOf(STEP_CA_DIR), 'https://step-ca:9000', 'origin keeps non-default port');
assert.equal(originOf(LE_DIR), 'https://acme-v02.api.letsencrypt.org', 'default 443 omitted');

// per-origin scoping: a private root maps only to its own origin
const map = buildOriginRootMap([{ directoryUrl: STEP_CA_DIR, rootPem: ROOT_A_PEM }]);
assert.deepEqual([...map.keys()], ['https://step-ca:9000'], 'only step-ca origin present');
assert.equal(map.get('https://acme-v02.api.letsencrypt.org'), undefined, 'LE origin has no private root');

// setTrustRoots + pickAgentForUrl
setTrustRoots([{ directoryUrl: STEP_CA_DIR, rootPem: ROOT_A_PEM }]);
const agent = pickAgentForUrl('https://step-ca:9000/acme/acme/new-order')!;
assert.ok(agent, 'agent for step-ca origin');
assert.ok((agent.options.ca as string[]).includes(ROOT_A_PEM), 'agent trusts the pinned root');
assert.ok((agent.options.ca as string[]).length > 1, 'agent also includes public roots (superset per-origin)');
assert.equal(pickAgentForUrl('https://acme-v02.api.letsencrypt.org/directory'), undefined,
  'no private agent for a public CA host => private root NOT trusted for LE');

// applyTrust always disables redirects
assert.equal(applyTrust({ url: LE_DIR }).maxRedirects, 0, 'maxRedirects forced to 0');

// interceptor is a singleton: installing twice adds exactly one handler
const before = (acme.axios.interceptors.request as any).handlers.length;
installTrustInterceptor();
installTrustInterceptor();
const after = (acme.axios.interceptors.request as any).handlers.length;
assert.equal(after - before, 1, 'interceptor registered exactly once');

console.log('certs/acme-trust: ALL PASSED');
