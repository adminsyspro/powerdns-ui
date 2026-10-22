import assert from 'node:assert';
import { shouldConvertToMaster } from '../../src/lib/integrations/sync';
import { sanitizeConfig } from '../../src/lib/integrations/store';

const native = (name: string, account = '') => ({ name, kind: 'Native', account });
const on = (extra: Record<string, unknown> = {}) => sanitizeConfig({ convertNativeToMaster: true, ...extra });

// Opt-in: off by default, and an old stored config without the field stays off.
assert.equal(sanitizeConfig({}).convertNativeToMaster, false);
assert.equal(shouldConvertToMaster(sanitizeConfig({}), native('a.fr.')), false);

// all-master scope: every forward Native zone.
assert.equal(shouldConvertToMaster(on(), native('a.fr.')), true);
assert.equal(shouldConvertToMaster(on(), { name: 'a.fr.', kind: 'Master', account: '' }), false);   // already Master
assert.equal(shouldConvertToMaster(on(), { name: 'a.fr.', kind: 'Slave', account: '' }), false);    // never touch Slave
assert.equal(shouldConvertToMaster(on(), native('1.168.192.in-addr.arpa.')), false);                // reverse
assert.equal(shouldConvertToMaster(on(), native('8.b.d.0.1.0.0.2.ip6.arpa.')), false);              // reverse v6

// Exceptions: canonicalized (case, trailing dot) and matched case-insensitively.
assert.equal(shouldConvertToMaster(on({ convertExceptions: ['Test.FR'] }), native('test.fr.')), false);
assert.equal(shouldConvertToMaster(on({ convertExceptions: ['test.fr.'] }), native('TEST.fr.')), false);
assert.equal(shouldConvertToMaster(on({ convertExceptions: ['test.fr.'] }), native('other.fr.')), true);

// groups scope: only zones of the selected groups.
assert.equal(shouldConvertToMaster(on({ scope: 'groups', groups: ['web'] }), native('a.fr.', 'web')), true);
assert.equal(shouldConvertToMaster(on({ scope: 'groups', groups: ['web'] }), native('a.fr.', 'mail')), false);

// zones scope: only the selected zones.
assert.equal(shouldConvertToMaster(on({ scope: 'zones', zones: ['a.fr'] }), native('a.fr.')), true);
assert.equal(shouldConvertToMaster(on({ scope: 'zones', zones: ['a.fr'] }), native('b.fr.')), false);
console.log('shouldConvertToMaster: ALL PASSED');
