#!/usr/bin/env sh
# Stage-7 DR failover/failback runbook COMMANDS (RTO <= 15 min). This is a guided operator tool, not an
# unattended automation — promotion is a deliberate act. No secrets. Run on the relevant host as postgres.
set -eu

ACTION="${1:-help}"
STANZA="${PGBACKREST_STANZA:-aptic}"

case "$ACTION" in
  promote) # on the STANDBY: promote to primary (failover)
    echo "[dr] promoting standby to primary…"
    pg_ctl promote -D "${PGDATA:?export PGDATA}"
    echo "[dr] promoted. Now: (1) repoint the app DATABASE_URL / DNS to this host,"
    echo "     (2) verify /api/v1/health = 200 and a canary write, (3) record achieved RTO/RPO."
    ;;
  reconcile) # after promote: integrity check before declaring clean
    echo "[dr] run reconciliation (examples):"
    echo "  psql -c \"SELECT count(*) FROM tenants;\"  # expected control total"
    echo "  psql -c \"SELECT scope_key, max(seq) FROM audit_events GROUP BY 1 ORDER BY 1;\"  # audit chain tails intact"
    ;;
  rebuild-old-primary) # failback step 1: rebuild the former primary as a standby of the promoted node
    echo "[dr] on the OLD primary: bootstrap it as a standby of the new primary via standby-bootstrap.sh,"
    echo "     then resync and, in a maintenance window, switch back (controlled switchover)."
    ;;
  switchover) # failback step 2: controlled switch back to the original primary
    echo "[dr] controlled switchover: quiesce writes, confirm standby caught up (0 lag), promote target,"
    echo "     repoint app, verify. This is planned (near-zero data loss), unlike an emergency failover."
    ;;
  *)
    cat <<EOF
usage: $0 {promote|reconcile|rebuild-old-primary|switchover}
  promote              (standby) emergency failover — promote to primary
  reconcile            integrity/control-total checks post-promote
  rebuild-old-primary  failback: make the old primary a standby of the new one
  switchover           failback: planned controlled switch back
Stanza: $STANZA. See STAGE_7_OFFSERVER_DR_ARCHITECTURE_DECISION.md.
EOF
    ;;
esac
