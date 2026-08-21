#!/usr/bin/env sh
# Bootstrap the warm standby (2nd Contabo VPS, different DC) from the pgBackRest repo, then start streaming.
# Run on the STANDBY host as the postgres user. Opaque creds from env. Destructive on the standby's PGDATA.
set -eu

STANZA="${PGBACKREST_STANZA:-aptic}"
PGDATA="${PGDATA:?export PGDATA (standby data dir)}"
PRIMARY_HOST="${PRIMARY_HOST:?export PRIMARY_HOST (primary private address)}"
SLOT="${REPLICATION_SLOT:-standby1}"
: "${B2_S3_ENDPOINT:?}"
: "${B2_BUCKET:?}"
: "${B2_KEY_ID:?}"
: "${B2_APP_KEY:?}"
: "${PGBACKREST_CIPHER_PASS:?}"

if [ -s "$PGDATA/PG_VERSION" ]; then
  echo "[dr] refusing: $PGDATA is not empty. Move it aside first (safety)." >&2
  exit 1
fi

echo "[dr] restoring base backup from the repo into $PGDATA"
pgbackrest --stanza="$STANZA" --delta --type=standby restore

echo "[dr] writing standby signal + primary_conninfo (password via pgpass, NOT here)"
touch "$PGDATA/standby.signal"
CONNINFO="host=$PRIMARY_HOST port=5432 user=replicator application_name=$SLOT"
{
  echo "primary_conninfo = '$CONNINFO'"
  echo "primary_slot_name = '$SLOT'"
  echo "restore_command = 'pgbackrest --stanza=$STANZA archive-get %f %p'"
  echo "hot_standby = on"
} >> "$PGDATA/postgresql.auto.conf"

echo "[dr] start PostgreSQL on the standby, then verify with dr-healthcheck.sh (expect replay + low lag)."
echo "[dr] reminder: on the PRIMARY create the physical replication slot named $SLOT before starting the standby."
