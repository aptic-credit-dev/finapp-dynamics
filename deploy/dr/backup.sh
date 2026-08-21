#!/usr/bin/env sh
# Stage-7 DR backup driver (pgBackRest → immutable off-provider store). Idempotent + checksum-verified by pgBackRest.
# Opaque credentials come from the host env (see env.dr.example). No secret is echoed. Run as the postgres user.
set -eu

STANZA="${PGBACKREST_STANZA:-aptic}"
TYPE="${1:-incr}" # full | diff | incr

# Fail closed if the off-provider credentials are not present (never silently back up to nowhere).
: "${B2_S3_ENDPOINT:?B2_S3_ENDPOINT not set}"
: "${B2_BUCKET:?B2_BUCKET not set}"
: "${B2_KEY_ID:?B2_KEY_ID not set}"
: "${B2_APP_KEY:?B2_APP_KEY not set}"
: "${PGBACKREST_CIPHER_PASS:?PGBACKREST_CIPHER_PASS not set}"

echo "[dr] ensuring stanza '$STANZA' exists…"
pgbackrest --stanza="$STANZA" stanza-create 2>/dev/null || echo "  stanza already created"

echo "[dr] checking config/archive health…"
pgbackrest --stanza="$STANZA" check

echo "[dr] running $TYPE backup…"
pgbackrest --stanza="$STANZA" --type="$TYPE" backup

echo "[dr] backup complete. Latest set:"
pgbackrest --stanza="$STANZA" info | sed -n '1,20p'
