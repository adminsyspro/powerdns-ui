# Let's Encrypt staging live-smoke runbook

Manual, end-to-end validation of the ACME DNS-01 issuance + renewal engine
against **Let's Encrypt staging**. This is the only way this engine has been
exercised against a real CA — there is no automated HTTP-route test harness
(see "Known deferred items" at the end). Never point this runbook at Let's
Encrypt **production** (`acme-v02.api.letsencrypt.org`); staging issues
certs signed by an untrusted test root and has much higher rate limits, which
is exactly what you want while poking at the engine.

Staging directory URL:

```
https://acme-staging-v02.api.letsencrypt.org/directory
```

## 1. Prerequisites

- A PowerDNS server connection already configured in the app (Settings →
  Servers) that is **authoritative** for a real, publicly-resolvable test
  zone. Let's Encrypt's DNS-01 validator queries the public DNS for
  `_acme-challenge.<name>` TXT records, so the zone must actually resolve on
  the public internet — a private/internal-only zone will not work.
- Outbound HTTPS from the app server to
  `acme-staging-v02.api.letsencrypt.org` (443).
- Admin access to the PowerDNS UI (the `/certificates` page and its APIs are
  gated `requireAdmin`).
- A throwaway subdomain or apex you're comfortable issuing test certs for
  (e.g. `smoke.example.com`).

## 2. Enable the feature

Set in the app's environment and restart the app:

```
CERTS_ENABLED=true
NEXT_PUBLIC_CERTS_ENABLED=true
APP_SECRET=<openssl rand -hex 32>   # REQUIRED — see "Known deferred items" below
CERTS_DIR=/data/certs
CERT_RENEWAL_ENABLED=true
```

Reference (`.env.example`), with shipped defaults:

| Var | Default | Purpose |
|---|---|---|
| `CERTS_ENABLED` | `false` | Master switch — gates `/api/certs`, the issuance/renewal workers, and materialization. |
| `NEXT_PUBLIC_CERTS_ENABLED` | `false` | Sidebar link visibility. Must match `CERTS_ENABLED`. |
| `CERTS_DIR` | `/data/certs` | Materialization root (should be the same volume/NFS export the consuming web servers read from). |
| `CERT_WORKER_INTERVAL_MS` | `60000` | Issuance worker poll interval (floor 30s). |
| `CERT_RENEWAL_ENABLED` | `true` | Set `false` to disable auto-renewal; certs still issue on demand. |
| `CERT_RENEWAL_INTERVAL_MS` | `21600000` (6h) | Renewal scan interval (floor 30s). |
| `CERT_JOB_STALE_MS` | `900000` (15min) | A `running` job older than this is reclaimed after a worker crash (floor 10min). |
| `APP_SECRET` | *(falls back to `AUTH_SECRET`, then a public default)* | Encryption-key derivation secret for data at rest (ACME account keys, EAB HMAC, cert private keys). **Must be set explicitly for this smoke** — see below. |

Note the deferred security item: `APP_SECRET` must be set whenever
`CERTS_ENABLED=true`. Without it, secrets are encrypted with a fallback
(`AUTH_SECRET`, or ultimately a hard-coded public default key baked into the
source) — fine for a first boot, not fine to leave that way. Set it before
doing anything with real ACME account keys or certificate private keys.

After restart, confirm the sidebar shows **"Certificats SSL"** (admin-only
nav item, shown at `/certificates`).

## 3. Create + register an ACME account

Go to `/certificates` → tab **"Comptes ACME"** → **"Ajouter un compte"**.
The dialog defaults `Directory URL` to the LE staging endpoint already, so
for this smoke you mostly just need to fill in the rest:

- **Directory URL**: `https://acme-staging-v02.api.letsencrypt.org/directory`
  (pre-filled)
- **Type de CA**: `Let's Encrypt`
- **Email de contact**: a real address you control (LE sends expiry
  notices to staging accounts too, harmlessly)
- **Propagation DNS**: `authoritative` (queries the zone's own
  authoritative nameservers for the TXT record rather than a public
  resolver — fastest and most reliable when PowerDNS is authoritative)
- Tick **"J'accepte les conditions d'utilisation (ToS) de la CA"**
- Click **"Créer"**

The account row appears with status `unregistered`. Click **"Enregistrer"**
(only enabled once ToS is ticked). Expect the status pill to flip to
`registered`. If it goes to `error`, the row shows a truncated
`lastError` — check outbound connectivity to the staging directory URL.

## 4. Create a certificate

Tab **"Certificats"** → **"Créer un certificat"**:

- **Nom (identifiant / dossier sur disque)**: `smoke-test` — this becomes
  the on-disk directory name (see §6), so keep it lowercase/hyphenated.
- **SAN**: your test apex, optionally plus `*.<zone>` on its own line
- **Compte ACME**: the account registered in step 3
- **Connexion PowerDNS**: the connection covering your test zone
- **Type de clé**: `ECDSA` (default; `RSA` also available)
- **Renouvellement automatique**: on (default)

Click **"Créer"**. The new row appears with status `pending` /
renewal `idle`.

## 5. Issue

Click the **"Émettre maintenant"** action (refresh icon on the row, or the
button of the same name on the certificate detail page). This enqueues an
issuance job; the issuance worker picks it up on its next poll
(`CERT_WORKER_INTERVAL_MS`, default 60s).

Watch the app logs for `[cert-worker]` lines — they trace order creation,
TXT-record insertion, DNS propagation checks, challenge validation with LE
staging, finalization, and download of the issued chain. Within roughly
1–3 minutes the certificate's **Statut** pill should flip to `valid` (poll
the list, or open the certificate detail page).

If it lands on `error` instead, open the certificate detail page →
**"Historique"** tab for the failure event/message (common causes: zone not
actually publicly authoritative yet, propagation not finished, or a stale
ACME account).

## 6. Verify

Confirm all of the following:

- **Statut** = `valid` on the certificate list / detail page.
- An `issue` event appears in **Historique** on the certificate detail page
  (status `ok`).
- The `_acme-challenge` TXT record used for validation has been removed
  from the zone (the engine cleans it up after issuance — check via the
  Records page or `pdnsutil`/API).
- Files materialized on disk under `${CERTS_DIR}/live/smoke-test/`:

  | File | Mode | Contents |
  |---|---|---|
  | `privkey.pem` | `0600` | The certificate's private key |
  | `cert.pem` | `0644` | Leaf certificate only |
  | `chain.pem` | `0644` | Intermediate chain only |
  | `fullchain.pem` | `0644` | `cert.pem` + `chain.pem` concatenated |

  (This is the certbot-style `live/<name>/` layout — see
  `src/lib/certs/materialize.ts`. The parent `live/` directory itself is
  created `0700`.) Confirm `privkey.pem` really is `0600`
  (`stat -c '%a' privkey.pem`) — this is the file that must never be
  world- or group-readable.

## 7. Download

On the certificate detail page:

- **"Chaîne"** — `GET`s the public fullchain (`cert.pem` + `chain.pem`) as
  `<name>-fullchain.pem`. This is not sensitive (it's sent in every TLS
  handshake) so it is **not** gated by the key-download switch — only by
  admin auth. Confirm the download succeeds and the file opens as valid PEM.
- **"Clé + bundle"** — `POST`s the private key bundle (`privkey.pem` +
  fullchain) as `<name>-bundle.pem`. This one **is** audited: every
  successful download appends a `download` event to Historique with the
  acting admin's username and source IP, and the response is served with
  `Cache-Control: no-store`.

Now toggle **"Autoriser le download de la clé"** off (Configuration card on
the detail page) and try **"Clé + bundle"** again: the button becomes
disabled in the UI, and if called directly the API refuses with
`403 { "error": "private key download is disabled for this certificate" }`
— no event is recorded for a refused attempt (only successful bundle
downloads are audited). Toggle it back on afterward if you want to
re-test the download.

## 8. Renewal dry-check

To exercise the renewal path without waiting for a cert to actually near
expiry:

1. On the certificate detail page, raise **"Renouveler avant (jours)"**
   (default 30, range 1–90) to a value comfortably larger than the cert's
   remaining lifetime relative to LE staging's short-lived test certs —
   e.g. `90` — so the cert falls inside its own renewal window immediately.
2. Either wait one `CERT_RENEWAL_INTERVAL_MS` (default 6h — impractical for
   a smoke), or temporarily restart the app with a much lower
   `CERT_RENEWAL_INTERVAL_MS` (e.g. `60000`) for this test only.
3. Watch the logs for the renewal worker's scan; confirm a `renew` job is
   enqueued and then executed for `smoke-test`.
4. Confirm in Historique: a new `renew` event, and on the overview card a
   new (later) **"Expire le"** (`notAfter`) timestamp than before.
5. Confirm the certificate's `Statut` stayed `valid` throughout — a renewal
   in progress must not degrade the currently-served (still valid) cert.

Restore `renew_before_days` and `CERT_RENEWAL_INTERVAL_MS` to their normal
values afterward (see Teardown).

## 9. Teardown

- Delete the smoke certificate: **"Supprimer"** on the detail page or list
  row, confirm the destructive dialog. This removes both the DB row and the
  materialized `${CERTS_DIR}/live/smoke-test/` directory — confirm the
  directory is actually gone on disk. Note the CA-side certificate is
  **not** revoked automatically (the confirm dialog says so explicitly);
  for staging certs this is harmless and no action is needed.
- Optionally delete the ACME account too (**"Supprimer"** in the Comptes
  ACME tab) — this is refused with a 409 if any certificate still
  references it, so delete certs first.
- If you temporarily lowered `CERT_RENEWAL_INTERVAL_MS` (or any other
  interval) for step 8, restore it and restart the app.
- If this was a throwaway environment, you may also turn `CERTS_ENABLED` /
  `NEXT_PUBLIC_CERTS_ENABLED` back off.

## Known deferred items

- **`APP_SECRET` fail-closed requirement.** The app does not currently
  refuse to start, or warn at runtime, if `CERTS_ENABLED=true` and
  `APP_SECRET` is unset — it silently falls back to `AUTH_SECRET`, and
  ultimately to a hard-coded public default key (`src/lib/crypto.ts`) if
  neither is set. That default key is committed in the source tree, so any
  secret encrypted under it (ACME account keys, EAB HMAC, certificate
  private keys) offers no real confidentiality. Treat "set `APP_SECRET`
  explicitly" as a hard requirement for any non-toy deployment, not just for
  this smoke. Adding an actual startup guard (refuse to boot, or refuse to
  enable certs, without an explicit `APP_SECRET`) is left for a follow-up
  phase / deploy hardening pass — decide before going further than a
  staging smoke.
- **No route-level HTTP tests for `/api/certs/*`.** The issuance/renewal
  engine (job store, ACME client, DNS-01 provider, materialization) has
  unit/integration tests exercised via `npx tsx <test>` plus
  `tsc --noEmit` and `npm run build`, but there is no automated harness that
  drives the Next.js API routes themselves (auth gating, request/response
  shapes, the download route's 403 path, etc.). This runbook is currently
  the only end-to-end check of that surface — re-run it after any change
  touching `src/app/api/certs/**` before considering the change verified.
