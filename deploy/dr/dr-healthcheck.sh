#!/usr/bin/env sh
# Stage-7 DR health/readiness checks: replication lag (RPO risk), WAL archive status, backup age. Read-only.
# Run on the PRIMARY as postgres. Exits non-zero if any threshold is breached (for alerting/cron).
set -eu

STANZA="${PGBACKREST_STANZA:-aptic}"
MAX_LAG_BYTES="${MAX_LAG_BYTES:-16777216}"   # 16 MB replay lag alarm
MAX_BACKUP_AGE_H="${MAX_BACKUP_AGE_H:-26}"   # alarm if newest backup older than ~1 day
rc=0

echo "== replication (RPO) =="
psql -tAc "SELECT application_name, state, pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes
           FROM pg_stat_replication;" | while IFS='|' read -r name state lag; do
  echo "  standby=$name state=$state lag_bytes=${lag:-NA}"
  [ -n "${lag:-}" ] && [ "$lag" -gt "$MAX_LAG_BYTES" ] && { echo "  !! lag over threshold"; rc=1; }
done

echo "== WAL archiving =="
psql -tAc "SELECT archived_count, failed_count, last_failed_time FROM pg_stat_archiver;" || rc=1

echo "== pgBackRest backup age =="
if command -v pgbackrest >/dev/null 2>&1; then
  pgbackrest --stanza="$STANZA" --output=json info >/tmp/pgbr.json 2>/dev/null || { echo "  !! pgbackrest info failed"; rc=1; }
  echo "  (inspect /tmp/pgbr.json backup[].timestamp.stop; alarm if older than ${MAX_BACKUP_AGE_H}h)"
else
  echo "  pgbackrest not installed on this host"; rc=1
fi

echo "== OpenBao snapshot presence (if colocated monitoring) =="
echo "  ensure the latest deploy/openbao/snapshot.sh artifact is < 24h and pushed to the WORM target"

[ "$rc" -eq 0 ] && echo "DR health: OK" || echo "DR health: DEGRADED"
exit "$rc"
