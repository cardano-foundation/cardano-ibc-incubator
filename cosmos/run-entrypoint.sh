#!/usr/bin/env bash

set -euo pipefail

export CHAIN_WORKDIR="/root/entrypoint/workspace/entrypoint"
export ENTRYPOINT_HOME="${ENTRYPOINT_HOME:-/root/.entrypoint}"
export STAMP_FILE="${STAMP_FILE:-${ENTRYPOINT_HOME}/.caribic-init-stamp.json}"
export GENESIS_FILE="${GENESIS_FILE:-${ENTRYPOINT_HOME}/config/genesis.json}"

# shellcheck disable=SC1091
source /chain-state-hash.sh

if [ ! -f "${GENESIS_FILE}" ]; then
    echo "[RUN] Missing genesis file: ${GENESIS_FILE}" >&2
    echo "[RUN] Run init first (entrypoint-init) or run a clean startup." >&2
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

entrypointd_binary="$(resolve_entrypointd_binary || true)"
if [ -z "${entrypointd_binary}" ]; then
    echo "[RUN] Could not find entrypointd binary in PATH or ${CHAIN_WORKDIR}/build/entrypointd." >&2
    exit 1
fi

echo "[RUN] Starting ${entrypointd_binary} with --home ${ENTRYPOINT_HOME}"
exec "${entrypointd_binary}" start --home "${ENTRYPOINT_HOME}"
