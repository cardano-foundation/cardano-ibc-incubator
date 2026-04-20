#!/bin/sh
set -eu

OUTPUT_PATH="${1:-${BRIDGE_HISTORY_SNAPSHOT_OUTPUT_PATH:-/tmp/bridge-history.dump}}"
DB_HOST="${BRIDGE_HISTORY_DB_HOST:-bridge-history-postgres}"
DB_PORT="${BRIDGE_HISTORY_DB_PORT:-5432}"
DB_NAME="${BRIDGE_HISTORY_DB_NAME:-bridge_history}"
DB_USER="${BRIDGE_HISTORY_DB_USERNAME:-bridge}"
DB_PASSWORD="${BRIDGE_HISTORY_DB_PASSWORD:-dbpass}"

export PGPASSWORD="$DB_PASSWORD"

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -f "$OUTPUT_PATH"

echo "bridge-history snapshot exported to $OUTPUT_PATH"
