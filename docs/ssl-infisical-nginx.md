# Serving certificates from Infisical (Nginx, Kubernetes)

PowerDNS-UI issues and renews the certificates, then publishes them to Infisical
as key/value secrets (`PRIVKEY`, `CERT`, `CHAIN`, `FULLCHAIN`). Consumers pull
their own certificate from Infisical:

- **Nginx servers**: a cron script (§ 3–6);
- **Kubernetes clusters**: the Infisical Operator (§ 7).

```
PowerDNS-UI ──publishes──► Infisical project "tls-<consumer>" ◄──reads (Viewer)── consumer
 (issuer)                   PRIVKEY CERT CHAIN FULLCHAIN                           cron / Operator
```

## 1. Isolation model: one Infisical project per consumer

A consumer must only be able to read **its own** private key.

- Built-in roles (Viewer, Member…) apply to a **whole project**.
- Path-scoped custom roles require a paid Infisical plan, and so does
  folder-level access control.

So the boundary is the project:

| Item | Setting |
|------|---------|
| Project | `tls-<consumer>` (e.g. `tls-ascender`), one environment (e.g. `prod`). **Nothing else in it.** |
| Consumer identity | Machine identity `<consumer>` (Universal Auth), built-in role **Viewer** on that project only |
| PowerDNS-UI identity | Built-in role **Member** on that project (it writes the secrets) |

> The project must contain only that consumer's certificates. Anything else
> in it becomes readable by the consumer.

### Create a consumer project (Infisical UI)

1. **Projects → Add project**: name it `tls-<consumer>` and keep a single environment (e.g. `prod`).
2. **Access Control → Machine Identities**: add PowerDNS-UI's identity with role **Member**.
3. **Organization → Machine Identities**: create `<consumer>`, then add **Universal Auth** and copy the Client ID and Client Secret.
4. **Project → Access Control → Machine Identities**: add `<consumer>` with role **Viewer**.

### Publish the certificate to it (PowerDNS-UI)

1. Open **SSL Certificates → the certificate → Distribution → Add destination**.
2. Connection: your Infisical connection. Then fill in:
   - **Project ID**: the consumer project;
   - **Environment**: `prod`;
   - **Path**: `/{name}`, which gives `/ascender-api-infra` for `ascender-api-infra`. Dots in names become dashes.
3. **Add and publish**. The destination then shows `published`.
4. Use **Test** to check access read-only.

Renewals are republished to every destination automatically. If a publish
fails, the destination shows the error and is retried with backoff
(5 min → 6 h).

## 2. Store credentials on the Nginx server

```bash
sudo mkdir -p /etc/infisical /opt/infisical
sudo tee /etc/infisical/env > /dev/null <<'EOF'
INFISICAL_SITE_URL=https://vault.example.com
INFISICAL_PROJECT_ID=<tls-consumer project id>
INFISICAL_ENV=prod
INFISICAL_CLIENT_ID=<client-id>
INFISICAL_CLIENT_SECRET=<client-secret>
INFISICAL_BASE_PATH=/
INFISICAL_CERT_NAMES="my-cert-name"
EOF
sudo chmod 600 /etc/infisical/env
```

`INFISICAL_CERT_NAMES` is a space-separated list of folder names under
`INFISICAL_BASE_PATH`. Each one becomes a directory under `/etc/nginx/ssl/`.

## 3. Deploy the sync script

The script **fails loudly**: an authentication or permission error is logged
as an error and returns a non-zero exit code. It is never reported as
"no change".

```bash
sudo tee /opt/infisical/sync-certs.sh > /dev/null <<'SCRIPT'
#!/bin/bash
set -euo pipefail

source /etc/infisical/env

SSL_DIR="/etc/nginx/ssl"
CHANGED=0
FAILED=0
API="$INFISICAL_SITE_URL/api"
log() { logger -t infisical-sync "$*"; }

if [ -z "${INFISICAL_CERT_NAMES:-}" ]; then
  log "INFISICAL_CERT_NAMES not set, nothing to sync"
  exit 0
fi

# Authenticate via Universal Auth
if ! LOGIN=$(curl -sS --fail-with-body -X POST "$API/v1/auth/universal-auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"clientId\":\"$INFISICAL_CLIENT_ID\",\"clientSecret\":\"$INFISICAL_CLIENT_SECRET\"}" 2>&1); then
  log "ERROR: authentication failed: $LOGIN"
  exit 1
fi
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

AUTH="Authorization: Bearer $TOKEN"
BASE="${INFISICAL_BASE_PATH:-/}"

for cert_name in $INFISICAL_CERT_NAMES; do
  secret_path="$BASE"
  [ "$secret_path" = "/" ] && secret_path=""
  secret_path="${secret_path}/${cert_name}"
  encoded_path=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$secret_path")

  if ! SECRETS_JSON=$(curl -sS --fail-with-body -H "$AUTH" \
      "$API/v3/secrets/raw?workspaceId=$INFISICAL_PROJECT_ID&environment=$INFISICAL_ENV&secretPath=$encoded_path" 2>&1); then
    log "ERROR: cannot read $secret_path: $SECRETS_JSON"
    FAILED=1
    continue
  fi

  dest="$SSL_DIR/$cert_name"
  mkdir -p "$dest"
  for secret in FULLCHAIN PRIVKEY CERT CHAIN; do
    value=$(echo "$SECRETS_JSON" | python3 -c "
import sys, json
for s in json.load(sys.stdin).get('secrets', []):
    if s['secretKey'] == sys.argv[1]:
        print(s['secretValue'], end='')
        break
" "$secret")
    if [ -z "$value" ]; then
      [ "$secret" = "CHAIN" ] && continue   # may legitimately be empty
      log "ERROR: $secret missing in $secret_path"
      FAILED=1
      continue
    fi
    file="$dest/$(echo "$secret" | tr '[:upper:]' '[:lower:]').pem"
    if [ ! -f "$file" ] || [ "$(cat "$file")" != "$value" ]; then
      echo "$value" > "$file"
      CHANGED=1
    fi
  done

  chmod 644 "$dest/fullchain.pem" "$dest/cert.pem" "$dest/chain.pem" 2>/dev/null || true
  chmod 600 "$dest/privkey.pem" 2>/dev/null || true
done

if [ "$CHANGED" -eq 1 ]; then
  if command -v nginx >/dev/null 2>&1; then
    if nginx -t 2>/dev/null; then
      systemctl reload nginx
      log "Certificates updated, Nginx reloaded"
    else
      log "ERROR: certificates updated but nginx -t failed — NOT reloaded"
      FAILED=1
    fi
  else
    log "Certificates updated (Nginx not installed)"
  fi
elif [ "$FAILED" -eq 0 ]; then
  log "No certificate changes"
fi

[ "$FAILED" -eq 0 ] || log "ERROR: sync finished with errors (see above)"
exit "$FAILED"
SCRIPT

sudo chmod 700 /opt/infisical/sync-certs.sh
```

## 4. Set up the cron job

```bash
echo '*/5 * * * * root /opt/infisical/sync-certs.sh' | sudo tee /etc/cron.d/infisical-sync
```

## 5. Configure Nginx vhosts

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/ssl/my-cert-name/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/my-cert-name/privkey.pem;
}
```

## 6. Test manually

```bash
sudo /opt/infisical/sync-certs.sh; echo "exit=$?"
ls -la /etc/nginx/ssl/*/
journalctl -t infisical-sync --since -1h
openssl s_client -connect app.example.com:443 -servername app.example.com </dev/null 2>/dev/null | openssl x509 -noout -enddate
```

## 7. Kubernetes consumers (Infisical Operator)

The cluster pulls its certificate from its own project into a `kubernetes.io/tls`
secret. cert-manager is not involved: none of its issuers can *fetch* a
certificate issued elsewhere.

### Conditions

1. **Universal Auth, not Kubernetes Auth.** Kubernetes Auth makes Infisical call
   the cluster API to validate tokens: an inbound flow into the cluster.
2. **Use a dedicated secret name**, e.g. `<app>-tls-infisical`.
   - The Operator takes over an existing secret of the same name without any
     ownership check.
   - An installer that recreates its own TLS secret would therefore fight with it.
   - Point the Ingress at the dedicated secret.
3. **Use `creationPolicy: Orphan`.**
   - With `Owner`, deleting the `InfisicalSecret` deletes the TLS secret, and so
     does uninstalling the chart together with its CRDs.
   - Either way, the TLS secret disappears and the service is cut.
4. **Resolve Infisical by a name that pods resolve reliably.** Test from a pod
   before relying on it: `kubectl run -it --rm dns --image=busybox -- nslookup vault.example.com`.
5. **Monitor the certificate actually served**, e.g. an expiry probe at J-20 on
   `host:443`. It is the only end-to-end proof that delivery works.

### Manifests

```bash
helm repo add infisical-helm-charts https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/
helm install --namespace infisical-operator-system --create-namespace secrets-operator infisical-helm-charts/secrets-operator

kubectl -n ascender create secret generic infisical-universal-auth \
  --from-literal=clientId=<client-id> --from-literal=clientSecret=<client-secret>
```

```yaml
apiVersion: secrets.infisical.com/v1alpha1
kind: InfisicalSecret
metadata:
  name: ascender-tls
  namespace: ascender
spec:
  hostAPI: https://vault.example.com/api
  resyncInterval: 300
  authentication:
    universalAuth:
      credentialsRef:
        secretName: infisical-universal-auth
        secretNamespace: ascender
      secretsScope:
        projectId: <tls-ascender project id>
        envSlug: prod
        secretsPath: /ascender-api-infra
  managedKubeSecretReferences:
    - secretName: ascender-tls-infisical
      secretNamespace: ascender
      secretType: kubernetes.io/tls
      creationPolicy: Orphan
      template:
        includeAllSecrets: false
        data:
          tls.crt: "{{ .FULLCHAIN.Value }}"
          tls.key: "{{ .PRIVKEY.Value }}"
```

Then point the Ingress `tls.secretName` at `ascender-tls-infisical`.

To check the setup:

- `kubectl -n ascender get secret ascender-tls-infisical -o jsonpath='{.type}'`
  must show `kubernetes.io/tls`;
- `openssl s_client` against the host must show the PowerDNS-UI certificate.

## Adding a certificate to a consumer

1. In PowerDNS-UI, add a destination to the certificate, pointing at the consumer's project.
2. **Nginx**: add the name to `INFISICAL_CERT_NAMES`, reference it in the vhost, then run the script.
   **Kubernetes**: add another `InfisicalSecret`, or another managed secret reference.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `authentication failed` in `journalctl -t infisical-sync` | Wrong or rotated client ID/secret | Regenerate it in Infisical and update `/etc/infisical/env` |
| `cannot read …: 403` | Identity is not Viewer on that project | Project → Access Control |
| `cannot read …: 404` | Folder not published yet, or wrong path or name | Check the destination in PowerDNS-UI, then **Publish now** |
| Destination `error` in PowerDNS-UI | PowerDNS-UI identity is not Member of the project, or Infisical is unreachable | Click **Test** on the destination, fix the access; it is retried automatically |
| Served certificate expired but PowerDNS-UI shows a valid one | Delivery broken somewhere between PowerDNS-UI and the server | Check, in order: the destination status in PowerDNS-UI, the script log and its exit code, then `nginx -t` |
