import assert from 'node:assert';
import { shouldReReflagOrphan } from '../../src/lib/integrations/sync';

const scoped = new Set<string>(['in.fr.']);
assert.equal(shouldReReflagOrphan({ zoneName:'in.fr.', status:'ok', managed:'auto' }, scoped), false);     // in scope
assert.equal(shouldReReflagOrphan({ zoneName:'out.fr.', status:'ok', managed:'auto' }, scoped), true);      // out, auto, ok
assert.equal(shouldReReflagOrphan({ zoneName:'out.fr.', status:'ok', managed:'manual' }, scoped), false);   // out, MANUAL → pinned
assert.equal(shouldReReflagOrphan({ zoneName:'out.fr.', status:'orphan', managed:'auto' }, scoped), false); // already orphan
assert.equal(shouldReReflagOrphan({ zoneName:'out.fr.', status:'error', managed:'auto' }, scoped), false);  // error
console.log('shouldReReflagOrphan: ALL PASSED');
