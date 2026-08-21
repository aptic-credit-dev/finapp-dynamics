#!/usr/bin/env sh
# Point-in-time recovery from the immutable off-provider repo (ADR-132). Restores into a target PGDATA and
# recovers to a target time. Use for DR rehearsal AND real recovery. Opaque creds from env. Destructive on target.
set -eu

STANZA="${PGBACKREST_STANZA:-aptic}"
PGDATA="${PGDATA:?export PGDATA (target data dir; MUST be a throwaway/standby for a rehearsal)}"
TARGET_TIME="${1:-}" # e.g. "2026-08-21 12:00:00+00"; empty = restore to latest
: "${B2_S3_ENDPOINT:?}" ; : "${B2_BUCKET:?}" ; : "${B2_KEY_ID:?}" ; : "${B2_APP_KEY:?}" ; : "${PGBACKREST_CIPHER_PASS:?}"

if [ -n "$TARGET_TIME" ]; then
  echo "[dr] PITR restore to '$TARGET_TIME' → $PGDATA"
  pgbackrest --stanza="$STANZA" --delta --type=time --target="$TARGET_TIME" --target-action=promote restore
else
  echo "[dr] restore to LATEST → $PGDATA"
  pgbackrest --stanza="$STANZA" --delta restore
fi

echo "[dr] start PostgreSQL; it will recover, then verify:"
echo "     - row/control totals reconcile against expectation"
echo "     - SELECT pg_last_wal_replay_lsn();  and  SELECT max(recorded_at) FROM audit_events;"
echo "[dr] measure achieved RPO (data loss vs incident) and RTO (wall-clock to service) for the drill evidence."
