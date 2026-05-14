#!/usr/bin/env bash

set -euo pipefail

export CHAIN_WORKDIR="/root/cardano-entrypoint/workspace/cardano-entrypoint"
export CARDANO_ENTRYPOINT_HOME="${CARDANO_ENTRYPOINT_HOME:-${ENTRYPOINT_HOME:-/root/.cardano-entrypoint-data/node}}"
export STAMP_FILE="${STAMP_FILE:-${CARDANO_ENTRYPOINT_HOME}/.caribic-init-stamp.json}"
export GENESIS_FILE="${GENESIS_FILE:-${CARDANO_ENTRYPOINT_HOME}/config/genesis.json}"

# shellcheck disable=SC1091
source /chain-state-hash.sh

if [ ! -f "${GENESIS_FILE}" ]; then
    echo "[RUN] Missing genesis file: ${GENESIS_FILE}" >&2
    echo "[RUN] Run init first (cardano-entrypoint-init) or run a clean startup." >&2
    exit 1
fi

if [ ! -f "${STAMP_FILE}" ]; then
    echo "[RUN] Missing init stamp: ${STAMP_FILE}" >&2
    echo "[RUN] Refusing to start with unknown chain state. Run a clean startup." >&2
    exit 1
fi

expected_hash="$(compute_expected_init_hash)"
stored_hash="$(jq -r '.init_hash // empty' "${STAMP_FILE}")"
if [ -z "${stored_hash}" ]; then
    echo "[RUN] Init stamp missing 'init_hash': ${STAMP_FILE}" >&2
    exit 1
fi

if [ "${stored_hash}" != "${expected_hash}" ]; then
    echo "[RUN] Init hash mismatch for chain state." >&2
    echo "[RUN] Stored:   ${stored_hash}" >&2
    echo "[RUN] Expected: ${expected_hash}" >&2
    echo "[RUN] Refusing to start with incompatible state. Run a clean startup." >&2
    exit 1
fi

cardano_entrypointd_binary="$(resolve_cardano_entrypointd_binary || true)"
if [ -z "${cardano_entrypointd_binary}" ]; then
    echo "[RUN] Could not find cardano-entrypointd binary in PATH or ${CHAIN_WORKDIR}/build/cardano-entrypointd." >&2
    exit 1
fi

echo "[RUN] Starting ${cardano_entrypointd_binary} with --home ${CARDANO_ENTRYPOINT_HOME}"
exec "${cardano_entrypointd_binary}" start \
  --home "${CARDANO_ENTRYPOINT_HOME}" \
  --grpc.address "0.0.0.0:9090" \
  --api.address "tcp://0.0.0.0:1317"
