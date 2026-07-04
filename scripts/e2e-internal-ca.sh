#!/usr/bin/env bash
# End-to-end test of the bundled step-ca private CA (fully dockerized, isolated).
# Usage:  scripts/e2e-internal-ca.sh          run the full E2E, leave the stack up
#         scripts/e2e-internal-ca.sh --down   tear the stack down and purge volumes
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.e2e
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.e2e.yml --profile internal-ca)
BASE=http://localhost:3000
PDNS=http://localhost:8081
PDNS_KEY=changeme
CONN_URL=http://powerdns:8081
ZONE=internal.test
SAN=www.internal.test
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

command -v jq >/dev/null || { echo "ERROR: jq is required (apt-get install jq / brew install jq)"; exit 1; }

# Ensure an env file exists (throwaway secrets for this ephemeral test stack).
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
AUTH_SECRET=$(openssl rand -hex 32)
APP_SECRET=$(openssl rand -hex 32)
CERTS_ENABLED=true
NEXT_PUBLIC_CERTS_ENABLED=true
INTERNAL_CA_ENABLED=true
NEXT_PUBLIC_INTERNAL_CA_ENABLED=true
INTERNAL_CA_PROPAGATION_RESOLVER=172.31.0.53
EOF
  echo "wrote $ENV_FILE (throwaway test secrets)"
fi
mkdir -p secrets
[[ -f secrets/step_ca_password.txt ]] || openssl rand -base64 32 > secrets/step_ca_password.txt

if [[ "${1:-}" == "--down" ]]; then
  "${COMPOSE[@]}" down -v
  echo "stack down, volumes purged."
  exit 0
fi

echo "== bringing the stack up (build may take a few minutes) =="
"${COMPOSE[@]}" up -d --build

echo "== waiting for services =="
for i in $(seq 1 90); do curl -fsS -o /dev/null "$BASE/login" 2>/dev/null && break || sleep 2; done
curl -fsS -o /dev/null "$BASE/login" || { echo "app not up"; "${COMPOSE[@]}" logs --tail=40 powerdns-ui; exit 1; }
for i in $(seq 1 90); do [[ "$(docker inspect -f '{{.State.Health.Status}}' step-ca 2>/dev/null || echo none)" == "healthy" ]] && break || sleep 2; done
[[ "$(docker inspect -f '{{.State.Health.Status}}' step-ca 2>/dev/null || echo none)" == "healthy" ]] || { echo "step-ca not healthy"; "${COMPOSE[@]}" logs --tail=40 step-ca; exit 1; }
for i in $(seq 1 30); do curl -fsS -o /dev/null -H "X-API-Key: $PDNS_KEY" "$PDNS/api/v1/servers/localhost" 2>/dev/null && break || sleep 2; done
curl -fsS -o /dev/null -H "X-API-Key: $PDNS_KEY" "$PDNS/api/v1/servers/localhost" || { echo "pdns API not up"; exit 1; }
echo "   all services up."

echo "== login (admin/admin) =="
curl -fsS -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin"}' "$BASE/api/auth/login" >/dev/null

echo "== create PowerDNS connection =="
CONN_ID=$(curl -fsS -b "$COOKIE" -c "$COOKIE" -H 'content-type: application/json' \
  -d "{\"name\":\"e2e\",\"url\":\"$CONN_URL\",\"apiKey\":\"$PDNS_KEY\"}" \
  "$BASE/api/connections" | jq -r .id)
echo "   connection id: $CONN_ID"

echo "== create zone $ZONE in the test PowerDNS =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $PDNS_KEY" -H 'content-type: application/json' \
  -d "{\"name\":\"$ZONE.\",\"kind\":\"Native\",\"nameservers\":[\"ns1.$ZONE.\"]}" \
  "$PDNS/api/v1/servers/localhost/zones")
[[ "$code" == "201" || "$code" == "409" || "$code" == "422" ]] || { echo "zone create unexpected HTTP $code"; exit 1; }
echo "   zone create HTTP $code (201=created, 409/422=already exists)"

echo "== sync zones into the app cache =="
curl -fsS -b "$COOKIE" -c "$COOKIE" -X POST -H "x-pdns-connection-id: $CONN_ID" "$BASE/api/zones/sync" >/dev/null

echo "== internal-CA setup (auto-pin + register; retry until step-ca ready) =="
for i in $(seq 1 30); do
  code=$(curl -s -o /tmp/e2e-setup.json -w '%{http_code}' -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/certs/internal-ca/setup")
  [[ "$code" == "200" ]] && break
  echo "   setup HTTP $code (retry $i)"; sleep 3
done
[[ "$code" == "200" ]] || { echo "setup failed"; cat /tmp/e2e-setup.json; exit 1; }
ACCT_ID=$(jq -r .id /tmp/e2e-setup.json)
echo "   internal-step-ca account: $ACCT_ID ($(jq -r .status /tmp/e2e-setup.json))"

echo "== create certificate for $SAN =="
CERT_ID=$(curl -fsS -b "$COOKIE" -c "$COOKIE" -H 'content-type: application/json' \
  -d "{\"name\":\"$SAN\",\"acmeAccountId\":\"$ACCT_ID\",\"connectionId\":\"$CONN_ID\",\"sans\":[\"$SAN\"],\"keyType\":\"ecdsa\"}" \
  "$BASE/api/certs" | jq -r .id)
echo "   cert id: $CERT_ID"

echo "== issue =="
curl -fsS -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/certs/$CERT_ID/issue" >/dev/null

echo "== poll for status=valid =="
st=""
for i in $(seq 1 60); do
  st=$(curl -fsS -b "$COOKIE" -c "$COOKIE" "$BASE/api/certs/$CERT_ID" | jq -r .status) || st="pending"
  echo "   status: $st ($i)"
  [[ "$st" == "valid" ]] && break
  if [[ "$st" == "error" ]]; then
    echo "ISSUANCE ERROR:"; curl -s -b "$COOKIE" "$BASE/api/certs/$CERT_ID" | jq '{status,lastRenewalError,errorClass}'
    echo "--- step-ca logs ---"; "${COMPOSE[@]}" logs --tail=30 step-ca
    exit 1
  fi
  sleep 3
done
[[ "$st" == "valid" ]] || { echo "TIMEOUT waiting for valid"; exit 1; }

echo "== assert + dump =="
curl -fsS -b "$COOKIE" -c "$COOKIE" "$BASE/api/certs/$CERT_ID" | jq '{name,status,issuer,serial,notAfter}'
"${COMPOSE[@]}" exec -T powerdns-ui sh -c 'cat "${CERTS_DIR:-/app/data/certs}/live/'"$SAN"'/fullchain.pem"' \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName || echo "(fullchain dump skipped)"
echo
echo "E2E PASSED ✅  — stack left up. Open $BASE (admin/admin) → SSL Certificates to observe."
echo "Tear down with: scripts/e2e-internal-ca.sh --down"
