# Infisical → Nginx: certificate sync via CLI cron

Pull SSL certificates pushed by PowerDNS-UI to Infisical and deploy them
to Nginx servers automatically.

## Prerequisites

- PowerDNS-UI Infisical sync configured and working (certificates pushed)
- Infisical project with categories as top-level folders
- One Machine Identity per Nginx server/group (read-only, scoped to its category folder)

## 1. Install the Infisical CLI

```bash
# Debian / Ubuntu
curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | sudo bash
sudo apt install infisical-cli

# Verify
infisical --version
```

## 2. Create a read-only Machine Identity

In the Infisical web UI:

1. **Organization → Machine Identities** → create (e.g. `nginx-ecommerce`)
2. Click the identity → **Authentication** → add **Universal Auth** → copy **Client ID** and **Client Secret**
3. **Project PDNS → Access Control** → add the identity with role **Viewer**
4. Optionally create a custom role restricted to a specific path (e.g. `/DATACENTER/**`) for folder-level segmentation

## 3. Store credentials on the Nginx server

```bash
sudo mkdir -p /etc/infisical
sudo tee /etc/infisical/env > /dev/null <<'EOF'
INFISICAL_SITE_URL=https://vault.example.com
INFISICAL_PROJECT_ID=<your-project-id>
INFISICAL_ENV=prod
INFISICAL_CLIENT_ID=<client-id>
INFISICAL_CLIENT_SECRET=<client-secret>
# Restrict to a single category folder (leave empty for all)
INFISICAL_BASE_PATH=
EOF
sudo chmod 600 /etc/infisical/env
```

## 4. Deploy the sync script

```bash
sudo tee /opt/infisical/sync-certs.sh > /dev/null <<'SCRIPT'
#!/bin/bash
set -euo pipefail

source /etc/infisical/env

SSL_DIR="/etc/nginx/ssl"
CHANGED=0

# Authenticate
export INFISICAL_TOKEN
INFISICAL_TOKEN=$(infisical login \
  --method=universal-auth \
  --client-id="$INFISICAL_CLIENT_ID" \
  --client-secret="$INFISICAL_CLIENT_SECRET" \
  --domain="$INFISICAL_SITE_URL" \
  --plain --silent)

# Resolve base path (default: project root)
BASE="${INFISICAL_BASE_PATH:-/}"

# List certificate folders (each folder = one cert name)
FOLDERS=$(infisical secrets folders list \
  --path="$BASE" \
  --env="$INFISICAL_ENV" \
  --projectId="$INFISICAL_PROJECT_ID" \
  -o json 2>/dev/null | jq -r '.[].name // empty')

for cert_name in $FOLDERS; do
  cert_path="$BASE"
  [ "$cert_path" = "/" ] && cert_path=""
  secret_path="${cert_path}/${cert_name}"

  dest="$SSL_DIR/$cert_name"
  mkdir -p "$dest"

  for secret in FULLCHAIN PRIVKEY CERT CHAIN; do
    value=$(infisical secrets get "$secret" \
      --path="$secret_path" \
      --env="$INFISICAL_ENV" \
      --projectId="$INFISICAL_PROJECT_ID" \
      --plain 2>/dev/null || true)

    [ -z "$value" ] && continue

    file="$dest/$(echo "$secret" | tr '[:upper:]' '[:lower:]').pem"

    # Only write if content changed
    if [ ! -f "$file" ] || [ "$(cat "$file")" != "$value" ]; then
      echo "$value" > "$file"
      CHANGED=1
    fi
  done

  # Enforce permissions
  chmod 644 "$dest/fullchain.pem" "$dest/cert.pem" "$dest/chain.pem" 2>/dev/null || true
  chmod 600 "$dest/privkey.pem" 2>/dev/null || true
done

# Reload Nginx only if something changed
if [ "$CHANGED" -eq 1 ]; then
  nginx -t 2>/dev/null && systemctl reload nginx
  logger -t infisical-sync "Certificates updated, Nginx reloaded"
else
  logger -t infisical-sync "No certificate changes"
fi
SCRIPT

sudo chmod 700 /opt/infisical/sync-certs.sh
```

## 5. Set up the cron job

```bash
# Run every 5 minutes
echo '*/5 * * * * root /opt/infisical/sync-certs.sh' | sudo tee /etc/cron.d/infisical-sync
```

## 6. Configure Nginx vhosts

Each vhost points to the synced certificate files:

```nginx
server {
    listen 443 ssl http2;
    server_name shop.example.com;

    ssl_certificate     /etc/nginx/ssl/shop.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/shop.example.com/privkey.pem;

    # ...
}
```

The certificate folder name matches the certificate name in PowerDNS-UI.

## 7. Test manually

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
    │                              │   infisical secrets get      │
    │                              │<─────────────────────────────│
    │                              │                              │
    │                              │   write PEM files            │
    │                              │   nginx -t && reload         │
    │                              │─────────────────────────────>│
```

## Segmentation

- Each Nginx server has its own Machine Identity
- Each identity is scoped to its category folder (e.g. `/DATACENTER`)
- A server can only pull certificates from its authorized folder
- PowerDNS-UI pushes to all folders with a single writer identity

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `login failed` | Wrong client ID/secret | Regenerate in Infisical |
| `not member of this project` | Identity not added to project | Add in Access Control |
| `folder not found` | Wrong env slug or base path | Check `infisical secrets folders list` |
| Nginx not reloading | `nginx -t` fails | Check cert files are valid PEM |
| Empty secret value | Cert not synced yet | Run sync from PowerDNS-UI first |
