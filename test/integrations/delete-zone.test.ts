import assert from 'node:assert';
import { deleteZone } from '../../src/lib/integrations/cloudflare';

// Scripted fetch: each call pops the next reply and records method + path + body.
type Reply = { status: number; errors?: Array<{ code: number; message: string }> };
let replies: Reply[] = [];
let calls: string[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push(`${init.method} ${url.replace('https://api.cloudflare.com/client/v4', '')}${init.body ? ' ' + init.body : ''}`);
  const r = replies.shift();
  if (!r) throw new Error('unexpected Cloudflare call');
  const ok = r.status >= 200 && r.status < 300;
  return new Response(JSON.stringify({ success: ok, errors: r.errors ?? [], result: ok ? { id: 'z1' } : null }), { status: r.status });
}) as typeof fetch;

const creds = { apiToken: 't' } as Parameters<typeof deleteZone>[0];
const run = async (script: Reply[]) => {
  replies = script;
  calls = [];
  try {
    await deleteZone(creds, 'z1');
    return 'ok';
  } catch (e) {
    return e instanceof Error ? e.message : 'error';
  }
};
(async () => {
const E1316 = { status: 400, errors: [{ code: 1316, message: 'An Enterprise zone needs to be downgraded to the Free plan' }] };
const FREE = 'PUT /zones/z1/subscription {"rate_plan":{"id":"free"}}';

// Non-Enterprise zone: a single DELETE, no plan change.
assert.equal(await run([{ status: 200 }]), 'ok');
assert.deepEqual(calls, ['DELETE /zones/z1']);

// Enterprise zone: 1316 → downgrade to Free → DELETE again.
assert.equal(await run([E1316, { status: 200 }, { status: 200 }]), 'ok');
assert.deepEqual(calls, ['DELETE /zones/z1', FREE, 'DELETE /zones/z1']);

// Downgrade refused (token without Billing: Write): the error surfaces, no second DELETE.
const r = await run([E1316, { status: 403, errors: [{ code: 10000, message: 'Authentication error' }] }]);
assert.match(r, /10000/);
assert.deepEqual(calls, ['DELETE /zones/z1', FREE]);

// Zone already gone (404 / 1001) stays a success, with or without the downgrade path.
assert.equal(await run([{ status: 404 }]), 'ok');
assert.equal(await run([{ status: 400, errors: [{ code: 1001, message: 'Invalid zone identifier' }] }]), 'ok');
assert.equal(await run([E1316, { status: 200 }, { status: 404 }]), 'ok');

// Any other refusal is not mistaken for 1316: no downgrade.
assert.match(await run([{ status: 400, errors: [{ code: 1099, message: 'other' }] }]), /1099/);
assert.deepEqual(calls, ['DELETE /zones/z1']);

console.log('deleteZone (Enterprise downgrade before delete): ALL PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
