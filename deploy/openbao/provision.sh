#!/usr/bin/env sh
# End-to-end OpenBao provisioning for Aptic Dynamics (ADR-132), validated live on OpenBao 2.6.2
# (STAGE_7_OPENBAO_LIVE_BINDING_EVIDENCE.md). Run ON THE DEDICATED OPENBAO HOST, in deploy/openbao/.
#
# It deploys the compose stack (Raft + TLS + declarative audit), fixes the volume ownership if needed,
# initializes, unseals, applies transit + finapp-app policy + AppRole, verifies audit + health + TLS, and
# prints ONLY the RoleID. Init material (unseal keys + root token) is written to a ROOT-ONLY file and is
# NEVER printed or committed. The operator then moves that material into the approved custody model
# (STAGE_7_OPENBAO_CUSTODY_MODEL.md) and SHREDS the file. TLS material is supplied out-of-band.
#
# Requires: docker + compose; python3 (JSON) OR jq; TLS files in $OPENBAO_TLS_DIR (server.crt/server.key/ca.crt).
set -eu

ENV_FILE="${ENV_FILE:-.env.openbao}"
INIT_FILE="${OPENBAO_INIT_FILE:-/root/.openbao-init.json}"   # root-only; NEVER commit
CACERT="${OPENBAO_HOST_CACERT:-./tls/ca.crt}"
ADDR="https://127.0.0.1:8200"
KEY_SHARES="${OPENBAO_KEY_SHARES:-5}"
KEY_THRESHOLD="${OPENBAO_KEY_THRESHOLD:-3}"

json_get() { # $1=jsonfile $2=python-expression on obj `o`
  if command -v python3 >/dev/null 2>&1; then python3 -c "import json;o=json.load(open('$1'));print($2)"; \
  elif command -v jq >/dev/null 2>&1; then jq -r "$3" "$1"; \
  else echo "need python3 or jq" >&2; exit 1; fi
}

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (copy env.openbao.example)"; exit 1; }
[ -f ./tls/server.crt ] && [ -f ./tls/server.key ] && [ -f ./tls/ca.crt ] || {
  echo "missing TLS material in ./tls (server.crt/server.key/ca.crt) — supply out-of-band"; exit 1; }
mkdir -p audit && chmod 777 audit
DC="docker compose --env-file $ENV_FILE"

echo "[provision] deploy compose stack…"
$DC up -d
sleep 4
# Fix Raft volume ownership if the non-root process (uid 100) cannot write it (validated failure mode).
if docker logs aptic-openbao 2>&1 | grep -q "permission denied"; then
  echo "[provision] fixing Raft volume ownership (uid 100)…"
  $DC down >/dev/null 2>&1 || true
  VOL=$(docker volume ls --format '{{.Name}}' | grep openbao-raft | head -1)
  MP=$(docker volume inspect "$VOL" --format '{{.Mountpoint}}')
  chown -R 100:1000 "$MP"
  $DC up -d
fi

echo "[provision] waiting for OpenBao to listen (expect 501 = not initialised)…"
for _ in $(seq 1 30); do
  H=$(curl -s --cacert "$CACERT" -o /dev/null -w "%{http_code}" "$ADDR/v1/sys/health" 2>/dev/null || echo 000)
  [ "$H" = "501" ] || [ "$H" = "200" ] || [ "$H" = "503" ] && break
  sleep 2
done
echo "[provision] health=$H"

DEX="docker exec -e BAO_ADDR=$ADDR -e BAO_CACERT=/openbao/tls/ca.crt aptic-openbao bao"
if [ "$H" = "501" ]; then
  echo "[provision] initialising (output -> $INIT_FILE, root-only, NEVER printed)…"
  $DEX operator init -format=json -key-shares="$KEY_SHARES" -key-threshold="$KEY_THRESHOLD" > "$INIT_FILE"
  chmod 600 "$INIT_FILE"
fi
echo "[provision] unsealing (keys from $INIT_FILE; values never printed)…"
i=0; while [ "$i" -lt "$KEY_THRESHOLD" ]; do
  K=$(json_get "$INIT_FILE" "o['unseal_keys_b64'][$i]" ".unseal_keys_b64[$i]")
  $DEX operator unseal "$K" >/dev/null 2>&1 || true
  i=$((i+1))
done
sleep 2
curl -s --cacert "$CACERT" -o /dev/null -w "[provision] health after unseal=%{http_code}\n" "$ADDR/v1/sys/health"

echo "[provision] setup (transit + policy + AppRole; verify audit) using root token (not printed)…"
ROOT=$(json_get "$INIT_FILE" "o['root_token']" ".root_token")
BAO_ADDR="$ADDR" BAO_CACERT="$CACERT" BAO_TOKEN="$ROOT" \
  docker run --rm --network container:aptic-openbao -e BAO_ADDR="$ADDR" -e BAO_CACERT=/openbao/tls/ca.crt -e BAO_TOKEN="$ROOT" \
  -v "$(pwd)/policies:/policies:ro" openbao/openbao:latest sh -c '
    bao secrets enable transit 2>/dev/null || true
    bao policy write finapp-app /policies/finapp-app.hcl
    bao auth enable approle 2>/dev/null || true
    bao write auth/approle/role/finapp-app token_policies=finapp-app token_ttl=20m token_max_ttl=1h secret_id_ttl=24h secret_id_num_uses=0
    echo "audit device:"; bao audit list 2>/dev/null | grep "^file" || echo "  WARNING: no audit device (declare in config/openbao.hcl)"
    echo "RoleID:"; bao read -field=role_id auth/approle/role/finapp-app/role-id'

cat <<NOTE

[provision] DONE. NEXT (operator, out-of-band):
  1) Move the init material from $INIT_FILE into the approved CUSTODY model (Shamir holders / auto-unseal),
     then SHRED $INIT_FILE.  See STAGE_7_OPENBAO_CUSTODY_MODEL.md.
  2) Issue a response-wrapped SecretID for engineering:
       docker exec -e BAO_ADDR=$ADDR -e BAO_CACERT=/openbao/tls/ca.crt -e BAO_TOKEN=<root> aptic-openbao \\
         bao write -f -wrap-ttl=10m auth/approle/role/finapp-app/secret-id
  3) Configure the staging API FINAPP_OPENBAO_* (see deploy/staging/env.staging.example) and recreate the api.
  4) REVOKE the root token once custody + AppRole are in place.
NOTE
