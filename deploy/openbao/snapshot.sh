#!/usr/bin/env sh
# OpenBao Raft snapshot backup/restore (ADR-132). Snapshots are encrypted-at-rest by the off-server target
# (see deploy/dr). No token/unseal material is stored by this script; BAO_TOKEN comes from the operator shell.
set -eu

: "${BAO_ADDR:?export BAO_ADDR}"
: "${BAO_TOKEN:?export a privileged BAO_TOKEN (not committed)}"
ACTION="${1:-save}"
FILE="${2:-openbao-$(date -u +%Y%m%dT%H%M%SZ).snap}"

case "$ACTION" in
  save)
    echo "[openbao] taking Raft snapshot → $FILE"
    bao operator raft snapshot save "$FILE"
    sha256sum "$FILE" > "$FILE.sha256"
    echo "[openbao] snapshot + checksum written. Push to the off-server WORM target with deploy/dr/backup-upload.sh."
    ;;
  restore)
    echo "[openbao] verifying checksum before restore…"
    sha256sum -c "$FILE.sha256"
    echo "[openbao] restoring Raft snapshot from $FILE (DESTRUCTIVE on the target cluster)"
    bao operator raft snapshot restore "$FILE"
    echo "[openbao] restore complete — operator must unseal; then verify a canary transit read."
    ;;
  *)
    echo "usage: $0 [save|restore] [file]" >&2
    exit 2
    ;;
esac
