# Internal CA (bundled step-ca)

The app can run a private ACME CA (smallstep step-ca) and issue internal certificates
through it, or connect to a third-party ACME CA you already run.

## Bundled step-ca (turnkey)

1. Create the root password secret (never committed):
   ```bash
   mkdir -p secrets
   openssl rand -base64 32 > secrets/step_ca_password.txt
   ```
2. Enable the feature in your `.env`:
   ```bash
   CERTS_ENABLED=true
   NEXT_PUBLIC_CERTS_ENABLED=true
   INTERNAL_CA_ENABLED=true
   NEXT_PUBLIC_INTERNAL_CA_ENABLED=true
   INTERNAL_CA_PROPAGATION_RESOLVER=<ip-of-a-resolver-that-sees-your-internal-zones>
   ```
3. Start step-ca and the app:
   ```bash
   docker compose --profile internal-ca up -d
   ```
4. In the UI: **SSL Certificates → Internal CA → Set up internal CA**. This auto-pins
   the root from the shared read-only volume, creates the `internal-step-ca` ACME
   account, and registers it. If step-ca is still starting you get a retryable error —
   wait for its healthcheck, then retry.

### DNS validation caveat
step-ca must resolve your internal zones' `_acme-challenge` TXT to validate DNS-01.
Point step-ca's resolver at PowerDNS / an internal recursor, and set
`INTERNAL_CA_PROPAGATION_RESOLVER` to that **same** resolver — app-side propagation
success does not prove step-ca can validate.

### Security notes
- The app only ever reads step-ca's **public** certs (the `step-ca-public` volume, read-only),
  which a small root sidecar (`step-ca-pub`) copies out of step-ca's state. The root key and
  password stay inside step-ca (`step-ca-data`, never mounted in the app).
- Trust is pinned per CA origin: the internal root is trusted only for `step-ca:9000`,
  never for public CAs like Let's Encrypt.
- Consumers of issued certs must trust the root (download it from the Internal CA panel).

## Third-party ACME CA (external step-ca / EJBCA / Vault / Sectigo / DigiCert)

Use **SSL Certificates → ACME Accounts → Add account**, pick **step-ca (private)** or
**Other (ACME)**, set the directory URL, and pin the CA's root by pasting its **root PEM**
(recommended) or its **SHA-256 fingerprint**. Public-root ACME CAs need no root pinning.
