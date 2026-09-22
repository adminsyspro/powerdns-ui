import assert from 'node:assert';
import { zonePlan, needsPlanUpgrade, type CfZone } from '../../src/lib/integrations/cloudflare';

// Cloudflare zone object: `plan.id` is a 32-hex identifier, the plan NAME is `plan.legacy_id`.
const zone = (plan?: CfZone['plan']): CfZone =>
  ({ id: 'cf-a', name: 'a.com', type: 'secondary', status: 'active', plan });

assert.equal(zonePlan(zone(undefined)), undefined, 'plan omitted → undefined');
assert.equal(zonePlan(zone({ id: '0feeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'Free Website', legacy_id: 'free' })), 'free');
assert.equal(zonePlan(zone({ id: '94f3b7b768b0458b56d2cac4fe5ec0f9', name: 'Enterprise Website', legacy_id: 'enterprise' })), 'enterprise');
assert.equal(zonePlan(zone({ id: 'enterprise' })), undefined, 'plan.id is NOT the plan name (the old bug)');
assert.equal(zonePlan(zone({ id: 'x', legacy_id: 'Enterprise' })), 'enterprise', 'lower-cased');

// The production gate sync.ts applies (needsPlanUpgrade(zone, preExisted)).
const CREATED = false;  // zone we just created at Cloudflare
const ADOPTED = true;   // zone that pre-existed at Cloudflare

// Created: always ours to upgrade unless already Enterprise — Cloudflare creates on
// Free, and an omitted `plan` must not hide that.
assert.equal(needsPlanUpgrade(zone(undefined), CREATED), true, 'created + plan omitted → upgrade');
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'free' }), CREATED), true, 'created + free → upgrade');
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'pro' }), CREATED), true, 'created + pro → upgrade');
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'enterprise' }), CREATED), false, 'created + enterprise → nothing to do');

// Adopted: upgrade only from Free; paid self-serve or unknown plan = adopt-don't-touch.
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'free' }), ADOPTED), true, 'adopted + free → upgrade');
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'pro' }), ADOPTED), false, 'adopted + pro → leave alone');
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'business' }), ADOPTED), false, 'adopted + business → leave alone');
assert.equal(needsPlanUpgrade(zone(undefined), ADOPTED), false, 'adopted + plan omitted → unknown → leave alone');
assert.equal(needsPlanUpgrade(zone({ id: 'x', legacy_id: 'enterprise' }), ADOPTED), false, 'adopted + enterprise → nothing to do');

// The old bug's field: `{id:'enterprise'}` without legacy_id is an UNKNOWN plan.
assert.equal(needsPlanUpgrade(zone({ id: 'enterprise' }), ADOPTED), false, 'adopted + unknown (id-only) → leave alone');
assert.equal(needsPlanUpgrade(zone({ id: 'enterprise' }), CREATED), true, 'created + unknown (id-only) → still upgrade');

console.log('zonePlan + needsPlanUpgrade: ALL PASSED');
