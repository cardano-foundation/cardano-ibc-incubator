#!/bin/sh
set -eu
# DevKit's peer templates use pre-10.x spellings for these commands.
case "${1:-}" in
    stake-address|stake-pool) set -- conway "$@" ;;
esac
exec /app/cardano-bin/cardano-cli.bin "$@"
