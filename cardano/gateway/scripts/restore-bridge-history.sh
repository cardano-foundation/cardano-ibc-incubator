#!/bin/sh
set -eu

SNAPSHOT_PATH="${BRIDGE_HISTORY_SNAPSHOT_PATH:-}"
SNAPSHOT_URL="${BRIDGE_HISTORY_SNAPSHOT_URL:-}"
FORCE_RESTORE="${BRIDGE_HISTORY_SNAPSHOT_FORCE_RESTORE:-false}"

if [ -z "$SNAPSHOT_PATH" ] && [ -z "$SNAPSHOT_URL" ]; then
  exit 0
fi

DB_HOST="${BRIDGE_HISTORY_DB_HOST:-bridge-history-postgres}"
DB_PORT="${BRIDGE_HISTORY_DB_PORT:-5432}"
DB_NAME="${BRIDGE_HISTORY_DB_NAME:-bridge_history}"
DB_USER="${BRIDGE_HISTORY_DB_USERNAME:-bridge}"
DB_PASSWORD="${BRIDGE_HISTORY_DB_PASSWORD:-dbpass}"

export PGPASSWORD="$DB_PASSWORD"

wait_for_db() {
  attempts=0
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "bridge-history restore aborted: database did not become ready" >&2
      exit 1
    fi
    sleep 2
  done
}

has_existing_bridge_history() {
  table_exists="$(
    psql \
      -h "$DB_HOST" \
      -p "$DB_PORT" \
      -U "$DB_USER" \
      -d "$DB_NAME" \
      -tAc "SELECT to_regclass('public.bridge_sync_cursor') IS NOT NULL"
  )"

  if [ "$table_exists" != "t" ]; then
    return 1
  fi

  psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -tAc "SELECT EXISTS (SELECT 1 FROM bridge_sync_cursor WHERE cursor_name = 'default' AND last_block >= 0);" \
    | grep -q '^t$'
}

wait_for_db

if [ "$FORCE_RESTORE" != "true" ] && has_existing_bridge_history; then
  echo "bridge-history restore skipped: target database already contains synced bridge history"
  exit 0
fi

SNAPSHOT_FILE="${SNAPSHOT_PATH}"
TEMP_FILE=""

if [ -n "$SNAPSHOT_URL" ]; then
  TEMP_FILE="$(mktemp /tmp/bridge-history-snapshot.XXXXXX.dump)"
  SNAPSHOT_FILE="$TEMP_FILE"
  curl --fail --location --silent --show-error "$SNAPSHOT_URL" -o "$SNAPSHOT_FILE"
fi

if [ ! -f "$SNAPSHOT_FILE" ]; then
  echo "bridge-history restore aborted: snapshot file not found at $SNAPSHOT_FILE" >&2
  exit 1
fi

echo "restoring bridge-history snapshot into ${DB_NAME} on ${DB_HOST}:${DB_PORT}"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  "$SNAPSHOT_FILE"

if [ -n "$TEMP_FILE" ]; then
  rm -f "$TEMP_FILE"
fi

echo "bridge-history snapshot restore complete"
