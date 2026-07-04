# Internal CA — end-to-end test (bundled step-ca)

`scripts/e2e-internal-ca.sh` runs a fully isolated, dockerized proof that the
bundled step-ca can issue an internal certificate via ACME DNS-01.

## Prerequisites
- Docker + docker compose, and `jq`.
- Nothing else — the stack is self-contained (no real DNS/infra).

## Run
```bash
scripts/e2e-internal-ca.sh          # build + run; leaves the stack up
scripts/e2e-internal-ca.sh --down   # stop everything and purge volumes
```
On success it prints `E2E PASSED` and an `openssl x509` dump of the issued
`www.internal.test` cert (issuer = "PowerDNS UI Internal CA"). Then open
http://localhost:3000 (admin / admin) → **SSL Certificates** to observe or re-issue.

## What it wires
- One compose network; the test PowerDNS at `172.31.0.53`, authoritative for `internal.test`.
- `step-ca` uses `172.31.0.53` as its DNS resolver, so it self-validates the
  `_acme-challenge` TXT the app writes. The app polls the same resolver
  (`INTERNAL_CA_PROPAGATION_RESOLVER=172.31.0.53`) and auto-pins the step-ca
  root from the shared read-only public-certs volume.
- The script: login → create a PowerDNS connection (`http://powerdns:8081`) →
  create the `internal.test` zone → sync it into the app cache → **Internal CA
  setup** → create + issue a cert for `www.internal.test` → poll until `valid`.

## Troubleshooting
- **Stuck on issuance / propagation timeout:** step-ca couldn't resolve the TXT.
  Confirm `step-ca` has `dns: ["172.31.0.53"]` and the zone exists in the test
  PowerDNS. **Plan B:** if the authoritative-only PowerDNS doesn't satisfy
  step-ca's resolver, add a small `unbound`/`dnsmasq` recursor that forwards
  `internal.test` to `172.31.0.53`, and point both `step-ca.dns` and
  `INTERNAL_CA_PROPAGATION_RESOLVER` at the recursor.
- **`setup` keeps returning 503:** step-ca isn't healthy yet — the script retries;
  check `docker compose --profile internal-ca logs step-ca`.
- **`no managed zone for SAN`:** the zone-cache sync didn't run or targeted a
  different connection — re-run; the script syncs the `e2e` connection explicitly.
