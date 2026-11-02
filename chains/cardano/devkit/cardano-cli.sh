#!/bin/sh
set -eu
# DevKit's peer templates use pre-10.x spellings for these commands.
case "${1:-}" in
    stake-address|stake-pool) set -- conway "$@" ;;
esac
if [ "${1:-}:${2:-}" = node:issue-op-cert ]; then
    exec python3 /profile/cardano_cli.py "$@"
fi
exec /app/cardano-bin/cardano-cli.bin "$@"
