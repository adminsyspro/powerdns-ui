# Infisical → Nginx: certificate sync via REST API cron

Pull SSL certificates pushed by PowerDNS-UI to Infisical and deploy them
to Nginx servers automatically.

## Prerequisites

- PowerDNS-UI Infisical sync configured and working (certificates pushed)
- Infisical project with categories as top-level folders (e.g. `/DATACENTER`, `/WEBAPPS`)
- One Machine Identity per Nginx server (read-only, scoped to its certificate paths only)

## 1. Create a scoped Machine Identity

In the Infisical web UI:

1. **Organization → Machine Identities** → create (e.g. `nginx-proxcenter`)
2. Click the identity → **Authentication** → add **Universal Auth** → copy **Client ID** and **Client Secret**
3. **Project → Access Control** → add the identity
4. Create a **custom role** restricted to the specific certificate path(s) this server needs:
   - Secret Path: `/DATACENTER/my-cert-name/**`
   - Permissions: **Read Secrets** only

> **Least privilege**: each server should only access its own certificates.
> Avoid broad globs like `/DATACENTER/**` — if the server is compromised, the
> attacker would get every certificate in the category.

## 2. Store credentials on the Nginx server

```bash
sudo mkdir -p /etc/infisical /opt/infisical
sudo tee /etc/infisical/env > /dev/null <<'EOF'
INFISICAL_SITE_URL=https://vault.example.com
INFISICAL_PROJECT_ID=<your-project-id>
INFISICAL_ENV=prod
INFISICAL_CLIENT_ID=<client-id>
INFISICAL_CLIENT_SECRET=<client-secret>
INFISICAL_BASE_PATH=/DATACENTER
INFISICAL_CERT_NAMES="my-cert-name"
EOF
sudo chmod 600 /etc/infisical/env
```

`INFISICAL_CERT_NAMES` is a space-separated list of certificate folder names
to sync. Each name corresponds to a subfolder under `INFISICAL_BASE_PATH` in
Infisical and becomes a directory under `/etc/nginx/ssl/`.

For a server that needs multiple certificates:

```
INFISICAL_CERT_NAMES="app1-api-infra app2-api-infra"
```

## 3. Deploy the sync script

```bash
sudo tee /opt/infisical/sync-certs.sh > /dev/null <<'SCRIPT'
#!/bin/bash
set -euo pipefail

source /etc/infisical/env

SSL_DIR="/etc/nginx/ssl"
CHANGED=0
API="$INFISICAL_SITE_URL/api"

# Authenticate via Universal Auth
TOKEN=$(curl -sf -X POST "$API/v1/auth/universal-auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":\"$INFISICAL_CLIENT_ID\",\"clientSecret\":\"$INFISICAL_CLIENT_SECRET\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

AUTH="Authorization: Bearer $TOKEN"
BASE="${INFISICAL_BASE_PATH:-/}"
WS="$INFISICAL_PROJECT_ID"
ENV="$INFISICAL_ENV"

if [ -z "${INFISICAL_CERT_NAMES:-}" ]; then
  logger -t infisical-sync "INFISICAL_CERT_NAMES not set, nothing to sync"
  exit 0
fi

for cert_name in $INFISICAL_CERT_NAMES; do
  secret_path="$BASE"
  [ "$secret_path" = "/" ] && secret_path=""
  secret_path="${secret_path}/${cert_name}"
  encoded_path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$secret_path'))")

  dest="$SSL_DIR/$cert_name"
  mkdir -p "$dest"

  SECRETS_JSON=$(curl -sf -H "$AUTH" \
    "$API/v3/secrets/raw?workspaceId=$WS&environment=$ENV&secretPath=$encoded_path" 2>/dev/null || echo '{}')

  for secret in FULLCHAIN PRIVKEY CERT CHAIN; do
    value=$(echo "$SECRETS_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for s in d.get('secrets', []):
    if s['secretKey'] == '$secret':
        print(s['secretValue'], end='')
        break
" 2>/dev/null || true)

    [ -z "$value" ] && continue

    file="$dest/$(echo "$secret" | tr '[:upper:]' '[:lower:]').pem"

    if [ ! -f "$file" ] || [ "$(cat "$file" 2>/dev/null)" != "$value" ]; then
      echo "$value" > "$file"
      CHANGED=1
    fi
  done

  chmod 644 "$dest/fullchain.pem" "$dest/cert.pem" "$dest/chain.pem" 2>/dev/null || true
  chmod 600 "$dest/privkey.pem" 2>/dev/null || true
done

if [ "$CHANGED" -eq 1 ]; then
  if command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && systemctl reload nginx
    logger -t infisical-sync "Certificates updated, Nginx reloaded"
  else
    logger -t infisical-sync "Certificates updated (Nginx not installed)"
  fi
else
  logger -t infisical-sync "No certificate changes"
fi
SCRIPT

sudo chmod 700 /opt/infisical/sync-certs.sh
```

## 4. Set up the cron job

```bash
echo '*/5 * * * * root /opt/infisical/sync-certs.sh' | sudo tee /etc/cron.d/infisical-sync
```

## 5. Configure Nginx vhosts

Each vhost points to the synced certificate files:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/ssl/my-cert-name/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/my-cert-name/privkey.pem;

    # ...
}
```

The certificate folder name matches the certificate name in PowerDNS-UI.

## 6. Test manually

```bash
# First run
sudo /opt/infisical/sync-certs.sh

# Verify files
ls -la /etc/nginx/ssl/*/

# Check Nginx config
nginx -t

# Check logs
journalctl -t infisical-sync
```

## How it works

```
PowerDNS-UI                    Infisical                     Nginx server
    │                              │                              │
    │  push 4 PEM secrets          │                              │
    │  /<category>/<cert-name>/    │                              │
    │─────────────────────────────>│                              │
    │                              │   cron every 5min            │
    │                              │   curl REST API              │
    │                              │<─────────────────────────────│
    │                              │                              │
    │                              │   write PEM files            │
    │                              │   nginx -t && reload         │
    │                              │─────────────────────────────>│
```

## Segmentation

- Each Nginx server has its own Machine Identity
- Each identity is scoped to specific certificate paths (e.g. `/DATACENTER/proxcenter-api-infra/**`)
- A server can only pull the certificates listed in its `INFISICAL_CERT_NAMES`
- PowerDNS-UI pushes to all folders with a single writer identity

## Adding a certificate to a server

1. In Infisical, add a permission on the server's identity for the new path
2. Add the certificate name to `INFISICAL_CERT_NAMES` in `/etc/infisical/env`
3. Update the Nginx vhost to reference the new cert path
4. Run `/opt/infisical/sync-certs.sh` to pull immediately

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `accessToken` parse error | Wrong client ID/secret | Regenerate in Infisical |
| Empty secrets JSON | Identity lacks read permission on the path | Check custom role scope in Access Control |
| Certs not updating | `INFISICAL_CERT_NAMES` missing or wrong | Verify names match Infisical folder names |
| Nginx not reloading | `nginx -t` fails | Check cert files are valid PEM |
| Empty secret value | Cert not synced from PowerDNS-UI yet | Run sync from PowerDNS-UI first |
