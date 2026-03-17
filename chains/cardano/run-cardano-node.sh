#!/bin/sh
set -eu

CONFIG_FILE="/runtime/${CARDANO_RUNTIME_CONFIG_FILE:-cardano-node.json}"
TOPOLOGY_FILE="/runtime/${CARDANO_RUNTIME_TOPOLOGY_FILE:-topology.json}"

set -- run \
  --config "${CONFIG_FILE}" \
  --topology "${TOPOLOGY_FILE}" \
  --database-path /runtime/db \
  --socket-path /runtime/node.socket \
  --host-addr 0.0.0.0 \
  --port 3001

if [ "${CARDANO_BLOCK_PRODUCER:-true}" = "true" ]; then
  set -- "$@" \
    --shelley-kes-key /runtime/kes.skey \
    --shelley-vrf-key /runtime/vrf.skey \
    --shelley-operational-certificate /runtime/opcert.cert \
    --byron-delegation-certificate /runtime/byron-delegation.cert \
    --byron-signing-key /runtime/byron-delegate.key
fi

exec cardano-node "$@"
