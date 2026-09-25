# SOA-EDIT-API and disabled-record replication lab

Regression coverage for [issue #3](https://github.com/adminsyspro/powerdns-ui/issues/3).
The fixture runs a primary and a secondary on **PowerDNS 4.5.3**, with independent
SQLite databases. Only localhost ports are published; all data is disposable.

## Run

Requirements: Linux with Docker at `/usr/bin/docker` and the Compose plugin,
Node 20+, application dependencies, and (for the UI
checks) Playwright with Chromium. Use a separate checkout with an empty `data/`
directory and no existing server connections. The script uses the fresh lab app's
default `admin` / `admin` login and the fixture's test-only API key.

```sh
docker compose -f docker-compose.replication-test.yml up -d
# Wait until both APIs respond, then run DNS/API checks without a browser:
node scripts/e2e-soa-edit-api.mjs --dns-only
```

Start the app in a separate terminal from the isolated checkout:

```sh
AUTH_SECRET=issue3-isolated-app-secret \
APP_SECRET=issue3-isolated-app-secret \
PDNS_API_URL=http://127.0.0.1:18081 \
PDNS_API_KEY=issue3-lab-only \
npm run dev -- --hostname 127.0.0.1 --port 3103
```

Run the full test with Playwright installed in the test environment:

```sh
node scripts/e2e-soa-edit-api.mjs
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright `index.mjs` and
`CHROMIUM_PATH` to an existing Chromium executable, so no application dependency
needs to be added. `LAB_APP_URL` overrides the default `http://127.0.0.1:3103`.

The test creates unique `.test` zones and a temporary UI connection, then removes
them in `finally`. After testing, stop the app and remove the lab containers:

```sh
docker compose -f docker-compose.replication-test.yml down
```

## Assertions

1. Start with `soa_edit_api: ""`, serial `1000`, and an active A record. Transfer
   the zone to the secondary and query it over DNS.
2. Disable the record and send NOTIFY. The primary stops answering, but both
   serials remain `1000` and the secondary still returns the old A record.
3. In the browser, the zone summary and settings must show **Disabled (empty)**.
   The settings explain the effect on serials and secondaries. Saving without
   changing the policy must leave `soa_edit_api` empty.
4. Select `DEFAULT`, save, select the empty option, save and reopen, then select
   `DEFAULT` again. Assert each value through the real PowerDNS API.
5. Enable, disable, and re-enable the record. In the browser-enabled run, these
   PATCH requests pass through the application's authenticated proxy. Each change
   must advance the serial and transfer automatically to the secondary, without
   manual NOTIFY or forced AXFR. Query both servers over DNS.
6. When disabled, the primary API retains the disabled record; the secondary API
   contains no such record. Re-enabling restores the DNS answer on both servers.

## Observed regression

Before the UI fix, the DNS-only scenario passed and the browser regression failed
with `actual: 'SOA-EDIT-API: DEFAULT'` for an empty policy. The settings dialog also
replaced empty values with `DEFAULT` on load and save.

The full browser/DNS run passed after the fix on 2026-09-25:

| Policy / change | Primary serial | Secondary serial | Secondary A answer |
| --- | --- | --- | --- |
| Empty / disable + NOTIFY | 1000 | 1000 | Still present |
| DEFAULT / enable | 2026092501 | 2026092501 | Present |
| DEFAULT / disable | 2026092502 | 2026092502 | Absent |
| DEFAULT / re-enable | 2026092503 | 2026092503 | Present |

An empty policy disables automatic serial updates. `DEFAULT` enables them for
future record changes; changing this setting alone does not repair an already
stale secondary. Increase the SOA serial and allow the normal transfer, or request
a fresh AXFR from the secondary after correcting the configuration.

AXFR does not replicate the disabled flag: it omits disabled records. The record
should disappear from the secondary after a successful transfer. This lab proves
one way to reproduce the reported symptom, not the original reporter's actual
configuration.

References: [PowerDNS SOA-EDIT-API metadata](https://doc.powerdns.com/authoritative/domainmetadata.html#soa-edit-api),
[PowerDNS 4.5.3 API implementation](https://github.com/PowerDNS/pdns/blob/auth-4.5.3/pdns/ws-auth.cc),
[PowerDNS 4.5.3 AXFR implementation](https://github.com/PowerDNS/pdns/blob/auth-4.5.3/pdns/tcpreceiver.cc).
