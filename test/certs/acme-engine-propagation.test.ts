import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { authoritativeResolvers, waitForPropagationAllModes } from '../../src/lib/certs/acme-engine';

const zoneHit = () => 'internal.lan.';
const zoneMiss = () => undefined;

// two NS hosts: ns1 has v4 + v6, ns2 has v4 only
const lookup = {
  resolveNs: async (name: string) => {
    assert.equal(name, 'internal.lan', 'zone queried without trailing dot');
    return ['ns1.internal.lan.', 'ns2.internal.lan'];
  },
  resolve4: async (name: string) => (name.startsWith('ns1') ? ['10.0.0.53'] : ['10.0.0.54']),
  resolve6: async (name: string) => (name.startsWith('ns1') ? ['fd00::53'] : []),
};

async function main() {
  // --- authoritativeResolvers ---

  // happy path: NS hostnames resolved to IPs (v4 + v6 collected)
  const ips = await authoritativeResolvers('http://pdns', '_acme-challenge.a.internal.lan.', lookup, zoneHit);
  assert.deepEqual(ips, ['10.0.0.53', 'fd00::53', '10.0.0.54'], 'collects all NS IPs');

  // unknown zone → [] (system-resolver fallback)
  assert.deepEqual(
    await authoritativeResolvers('http://pdns', '_acme-challenge.x.example.org.', lookup, zoneMiss),
    [], 'unknown zone yields empty list'
  );

  // NS lookup throws → [] (never throws)
  const nsThrows = { ...lookup, resolveNs: async () => { throw new Error('ESERVFAIL'); } };
  assert.deepEqual(
    await authoritativeResolvers('http://pdns', '_acme-challenge.a.internal.lan.', nsThrows, zoneHit),
    [], 'NS lookup error yields empty list'
  );

  // zone has no NS records → []
  const nsEmpty = { ...lookup, resolveNs: async () => [] };
  assert.deepEqual(
    await authoritativeResolvers('http://pdns', '_acme-challenge.a.internal.lan.', nsEmpty, zoneHit),
    [], 'empty NS set yields empty list'
  );

  // NS hostnames exist but resolve to no IPs → []
  const noIps = {
    resolveNs: async () => ['ns1.internal.lan.'],
    resolve4: async (): Promise<string[]> => { throw new Error('ENODATA'); },
    resolve6: async (): Promise<string[]> => { throw new Error('ENODATA'); },
  };
  assert.deepEqual(
    await authoritativeResolvers('http://pdns', '_acme-challenge.a.internal.lan.', noIps, zoneHit),
    [], 'unresolvable NS hostnames yield empty list'
  );

  // --- waitForPropagationAllModes dispatch ---

  const byFqdn = new Map<string, string[]>([
    ['_acme-challenge.a.internal.lan.', ['tokenA']],
    ['_acme-challenge.b.internal.lan.', ['tokenB1', 'tokenB2']],
  ]);
  const calls: { fqdn: string; values: string[]; resolvers: string[] }[] = [];
  const wait = async (fqdn: string, values: string[], resolvers: string[]) => {
    calls.push({ fqdn, values, resolvers });
  };

  // resolver mode still throws when no resolver is configured
  await assert.rejects(
    () => waitForPropagationAllModes(byFqdn, { propagationMode: 'resolver', propagationResolver: null }, 'http://pdns', wait),
    /propagationResolver required/, 'resolver mode requires a resolver'
  );
  await assert.rejects(
    () => waitForPropagationAllModes(byFqdn, { propagationMode: 'resolver', propagationResolver: ' , ' }, 'http://pdns', wait),
    /propagationResolver required/, 'whitespace-only resolver list rejected'
  );
  assert.equal(calls.length, 0, 'nothing waited on before the throw');

  // resolver mode passes the configured (comma-separated) list through unchanged
  await waitForPropagationAllModes(byFqdn, { propagationMode: 'resolver', propagationResolver: '10.1.1.5, 10.2.2.5' }, 'http://pdns', wait);
  assert.equal(calls.length, 2, 'one wait per fqdn');
  assert.deepEqual(calls[0].resolvers, ['10.1.1.5', '10.2.2.5'], 'resolver mode uses the configured list');
  assert.deepEqual(calls[1].resolvers, ['10.1.1.5', '10.2.2.5'], 'same list for every fqdn');

  // default (authoritative) mode: per-fqdn discovered resolvers, [] as fallback
  calls.length = 0;
  const discover = async (serverUrl: string, fqdn: string) => {
    assert.equal(serverUrl, 'http://pdns', 'serverUrl threaded through');
    return fqdn.includes('.a.') ? ['10.0.0.53'] : [];
  };
  await waitForPropagationAllModes(byFqdn, { propagationMode: 'authoritative', propagationResolver: null }, 'http://pdns', wait, discover);
  assert.equal(calls.length, 2, 'one wait per fqdn');
  assert.deepEqual(
    calls[0],
    { fqdn: '_acme-challenge.a.internal.lan.', values: ['tokenA'], resolvers: ['10.0.0.53'] },
    'authoritative mode uses discovered NS IPs'
  );
  assert.deepEqual(calls[1].resolvers, [], 'undiscoverable NS falls back to empty list (system resolver)');
  assert.deepEqual(calls[1].values, ['tokenB1', 'tokenB2'], 'expected values passed through');

  // no hardcoded public resolvers remain in the engine
  const src = fs.readFileSync(path.join(__dirname, '../../src/lib/certs/acme-engine.ts'), 'utf8');
  assert.ok(!src.includes('1.1.1.1'), 'no 1.1.1.1 literal left');
  assert.ok(!src.includes('8.8.8.8'), 'no 8.8.8.8 literal left');
  assert.ok(!src.includes('PUBLIC_RESOLVERS'), 'PUBLIC_RESOLVERS constant removed');

  console.log('certs/acme-engine-propagation: ALL PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
