#!/usr/bin/env sh
# Post-init OpenBao setup for Aptic Dynamics (ADR-132). Run ONCE, AFTER the operator has initialised + unsealed
# and exported a privileged BAO_TOKEN in THIS shell (never committed, never printed by this script).
# Enables transit, installs the least-privilege policy, enables AppRole, binds the app role, enables audit.
# It prints the RoleID (needed by engineering) but NEVER a SecretID/token/unseal key — SecretID is issued wrapped, separately.
set -eu

: "${BAO_ADDR:?export BAO_ADDR (e.g. https://127.0.0.1:8200)}"
: "${BAO_TOKEN:?export a privileged BAO_TOKEN in this shell (not committed)}"
POLICY_FILE="${POLICY_FILE:-./policies/finapp-app.hcl}"
AUDIT_PATH="${AUDIT_PATH:-/openbao/audit/audit.log}"

echo "[openbao] enabling transit engine (idempotent)…"
bao secrets enable -path=transit transit 2>/dev/null || echo "  transit already enabled"

echo "[openbao] installing least-privilege policy 'finapp-app'…"
bao policy write finapp-app "$POLICY_FILE"

echo "[openbao] enabling AppRole auth (idempotent)…"
bao auth enable approle 2>/dev/null || echo "  approle already enabled"

echo "[openbao] binding role 'finapp-app' to the policy (short TTLs; renewable)…"
bao write auth/approle/role/finapp-app \
  token_policies="finapp-app" \
  token_ttl=20m token_max_ttl=1h \
  secret_id_ttl=24h secret_id_num_uses=0

echo "[openbao] enabling file audit device (fail-closed on write failure)…"
bao audit enable file file_path="$AUDIT_PATH" 2>/dev/null || echo "  audit device already enabled"

echo "[openbao] RoleID for engineering (store securely; NOT a secret by itself):"
bao read -field=role_id auth/approle/role/finapp-app/role-id

cat <<'NOTE'

NEXT (operator, out-of-band — NOT scripted here so no SecretID is ever captured to disk/logs):
  bao write -f -wrap-ttl=10m auth/approle/role/finapp-app/secret-id   # issue a RESPONSE-WRAPPED SecretID
  # hand the wrapping token to engineering out-of-band; they unwrap ONCE to obtain the SecretID.
Then engineering configures the API with FINAPP_OPENBAO_ADDR / _ROLE_ID / _SECRET_ID (see deploy env).
NOTE
