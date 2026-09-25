// Run against the disposable lab described in docs/soa-edit-api-lab.md.
// Requires Node 20+; browser checks also require Playwright and Chromium.
import assert from 'node:assert/strict';
import { Resolver } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const primary = 'http://127.0.0.1:18081';
const secondary = 'http://127.0.0.1:18082';
const app = process.env.LAB_APP_URL || 'http://127.0.0.1:3103';
const key = 'issue3-lab-only';
const zone = `soa-edit-api-${Date.now()}.test.`;
const record = `www.${zone}`;
const zonePath = `/zones/${zone}`;
const address = '192.0.2.123';
const dnsOnly = process.argv.includes('--dns-only');
let browser, context, connectionId;
const created = [];

async function api(server, path, method = 'GET', data) {
  const response = await fetch(`${server}/api/v1/servers/localhost${path}`, {
    method,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function answers(port) {
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  resolver.setServers([`127.0.0.1:${port}`]);
  try { return await resolver.resolve4(record); }
  catch (error) {
    if (['ENODATA', 'ENOTFOUND'].includes(error.code)) return [];
    throw error;
  }
}

async function until(check, message) {
  const deadline = Date.now() + 20_000;
  do {
    if (await check()) return;
    await delay(250);
  } while (Date.now() < deadline);
  assert.fail(message);
}

async function toggle(disabled) {
  const payload = { rrsets: [{ name: record, type: 'A', ttl: 60,
    changetype: 'REPLACE', records: [{ content: address, disabled }] }] };
  if (context) {
    const response = await context.request.patch(`${app}/api/pdns${zonePath}`, {
      headers: { 'x-pdns-connection-id': connectionId }, data: payload,
    });
    assert.ok(response.ok(), await response.text());
  } else {
    await api(primary, zonePath, 'PATCH', payload);
  }
}

try {
  const compose = ['compose', '-f', 'docker-compose.replication-test.yml'];
  const containerIP = (service) => execFileSync('docker', [...compose,
    'exec', '-T', service, 'hostname', '-i'], { encoding: 'utf8' }).trim();
  const primaryIP = containerIP('primary');
  const secondaryIP = containerIP('secondary');
  for (const server of [primary, secondary]) {
    const info = await api(server, '');
    console.log(`${server}: PowerDNS ${info.version}`);
  }
  await api(primary, '/zones', 'POST', {
    name: zone, kind: 'Master', soa_edit_api: '', nameservers: [],
    rrsets: [
      { name: zone, type: 'SOA', ttl: 60, records: [{ disabled: false,
        content: `ns.${zone} hostmaster.${zone} 1000 3600 60 86400 60` }] },
      { name: zone, type: 'NS', ttl: 60, records: [{ disabled: false, content: `ns.${zone}` }] },
      { name: `ns.${zone}`, type: 'A', ttl: 60, records: [{ disabled: false, content: primaryIP }] },
      { name: record, type: 'A', ttl: 60, records: [{ disabled: false, content: address }] },
    ],
  });
  created.push(primary);
  await api(primary, `${zonePath}/metadata/ALSO-NOTIFY`, 'PUT', {
    kind: 'ALSO-NOTIFY', metadata: [secondaryIP],
  });
  await api(secondary, '/zones', 'POST', { name: zone, kind: 'Slave', masters: [primaryIP] });
  created.push(secondary);
  await api(secondary, `${zonePath}/axfr-retrieve`, 'PUT');
  await until(async () => (await api(secondary, zonePath)).serial === 1000, 'Initial AXFR failed');
  assert.deepEqual(await answers(15302), [address]);

  await toggle(true);
  await api(primary, `${zonePath}/notify`, 'PUT');
  // Allow NOTIFY processing: it must not advance a secondary with the same serial.
  await delay(2500);
  assert.equal((await api(primary, zonePath)).soa_edit_api, '');
  assert.equal((await api(primary, zonePath)).serial, 1000);
  assert.equal((await api(secondary, zonePath)).serial, 1000);
  assert.deepEqual(await answers(15301), []);
  assert.deepEqual(await answers(15302), [address]);
  console.log('REPRODUCED: empty policy, serial 1000 on both; primary has no answer, secondary still serves A after NOTIFY');

  if (!dnsOnly) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post(`${app}/api/auth/login`, {
      data: { username: 'admin', password: 'admin' },
    });
    assert.ok(login.ok(), `Lab login failed: ${await login.text()}`);
    const connections = await context.request.get(`${app}/api/connections`);
    assert.ok(connections.ok(), await connections.text());
    assert.deepEqual(await connections.json(), [], 'Use an isolated app with no existing connections');
    const connection = await context.request.post(`${app}/api/connections`, {
      data: { name: zone, url: primary, apiKey: key },
    });
    assert.ok(connection.ok(), await connection.text());
    connectionId = (await connection.json()).id;
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${app}/zones/${zone}`);
    await page.locator('button[aria-label="Settings"]').waitFor();
    const summary = page.getByText('SOA-EDIT-API:', { exact: true }).locator('..');
    assert.match(await summary.innerText(), /Disabled/, 'Empty policy must not display DEFAULT');
    await page.locator('button[aria-label="Settings"]').click();
    const policy = page.getByRole('combobox', { name: 'SOA-EDIT-API', exact: true });
    assert.match(await policy.innerText(), /Disabled/, 'Settings must preserve the empty policy');
    await page.getByText('Automatic SOA serial updates are disabled.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await api(primary, zonePath)).soa_edit_api, '', 'Unchanged save must preserve empty policy');

    await page.locator('button[aria-label="Settings"]').click();
    await policy.click();
    await page.getByRole('option', { name: 'DEFAULT', exact: true }).click();
    assert.equal(await page.getByText('Automatic SOA serial updates are disabled.', { exact: false }).count(), 0);
    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await api(primary, zonePath)).soa_edit_api, 'DEFAULT');
    console.log('UI PASS: empty policy displayed, explained, preserved on save; DEFAULT selectable');

    // Exercise selecting the empty value too, including reopening the dialog.
    await page.locator('button[aria-label="Settings"]').click();
    await policy.click();
    await page.getByRole('option', { name: 'Disabled (empty)', exact: true }).click();
    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await api(primary, zonePath)).soa_edit_api, '');
    await page.locator('button[aria-label="Settings"]').click();
    assert.match(await policy.innerText(), /Disabled/);
    await policy.click();
    await page.getByRole('option', { name: 'DEFAULT', exact: true }).click();
    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    console.log('UI PASS: explicit DEFAULT → empty → DEFAULT round trip');
  } else {
    await api(primary, zonePath, 'PUT', { soa_edit_api: 'DEFAULT' });
  }

  await toggle(false);
  let serial = (await api(primary, zonePath)).serial;
  assert.ok(serial > 1000);
  await until(async () => (await api(secondary, zonePath)).serial === serial, 'Re-enable did not replicate');
  assert.deepEqual(await answers(15302), [address]);
  console.log(`DEFAULT: re-enabled, both serials ${serial}, secondary serves A`);

  await toggle(true);
  const disabledSerial = (await api(primary, zonePath)).serial;
  assert.ok(disabledSerial > serial);
  await until(async () => (await api(secondary, zonePath)).serial === disabledSerial, 'Disable did not replicate');
  assert.deepEqual(await answers(15301), []);
  assert.deepEqual(await answers(15302), []);
  assert.ok((await api(primary, zonePath)).rrsets.find(r => r.name === record).records[0].disabled);
  assert.ok(!(await api(secondary, zonePath)).rrsets.some(r => r.name === record));
  console.log(`DEFAULT: disabled, both serials ${disabledSerial}, no DNS answer; record retained only on primary`);

  await toggle(false);
  serial = (await api(primary, zonePath)).serial;
  assert.ok(serial > disabledSerial);
  await until(async () => (await api(secondary, zonePath)).serial === serial, 'Final re-enable did not replicate');
  assert.deepEqual(await answers(15301), [address]);
  assert.deepEqual(await answers(15302), [address]);
  console.log(`PASS: re-enabled, both serials ${serial}, A restored on both servers`);
} finally {
  const cleanups = [
    ...(connectionId ? [async () => {
      const response = await context.request.delete(`${app}/api/connections/${connectionId}`);
      assert.ok(response.ok(), `Connection cleanup: ${response.status()}`);
    }] : []),
    () => browser?.close(),
    ...created.reverse().map(server => () => api(server, zonePath, 'DELETE')),
  ];
  for (const cleanup of cleanups) {
    try { await cleanup(); }
    catch (error) {
      console.error('Lab cleanup failed:', error);
      process.exitCode = 1;
    }
  }
}
