#!/usr/bin/env bash

set -euo pipefail

if [ -f "$HOME/.bashrc" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.bashrc"
fi

export PATH="/root/.ignite/bin:/go/bin:/usr/local/go/bin:${PATH}"
export CHAIN_WORKDIR="/root/entrypoint/workspace/entrypoint"
export ENTRYPOINT_HOME="${ENTRYPOINT_HOME:-/root/.entrypoint-data/node}"
export STAMP_FILE="${STAMP_FILE:-${ENTRYPOINT_HOME}/.caribic-init-stamp.json}"
export GENESIS_FILE="${GENESIS_FILE:-${ENTRYPOINT_HOME}/config/genesis.json}"
export IGNITE_DEFAULT_HOME="/root/.entrypoint"

# shellcheck disable=SC1091
source /chain-state-hash.sh

cd "${CHAIN_WORKDIR}"

skip_proto_value="${IGNITE_SKIP_PROTO:-1}"
skip_proto_normalized="$(normalize_skip_proto_value "${skip_proto_value}")"
skip_proto_flag=""
if [ "${skip_proto_normalized}" = "1" ]; then
    skip_proto_flag="--skip-proto"
fi

expected_hash="$(compute_expected_init_hash)"
config_hash="$(config_sha256)"
binary_hash="$(entrypointd_sha256_or_missing)"

if [ -f "${GENESIS_FILE}" ]; then
    if [ ! -f "${STAMP_FILE}" ]; then
        echo "[INIT] Existing genesis found but missing init stamp at ${STAMP_FILE}." >&2
        echo "[INIT] Refusing to reuse unknown chain home. Run a clean start to reinitialize." >&2
        exit 1
    fi

    stored_hash="$(jq -r '.init_hash // empty' "${STAMP_FILE}")"
    if [ -z "${stored_hash}" ]; then
        echo "[INIT] Init stamp missing 'init_hash': ${STAMP_FILE}" >&2
        echo "[INIT] Refusing to reuse unknown chain home. Run a clean start to reinitialize." >&2
        exit 1
    fi

    if [ "${stored_hash}" != "${expected_hash}" ]; then
        echo "[INIT] Init hash mismatch for existing chain home." >&2
        echo "[INIT] Stored:   ${stored_hash}" >&2
        echo "[INIT] Expected: ${expected_hash}" >&2
        echo "[INIT] Refusing to reuse incompatible state. Run a clean start to reinitialize." >&2
        exit 1
    fi

    echo "[INIT] Existing chain home matches init hash; skipping initialization."
    exit 0
fi

echo "[INIT] No existing chain home found. Running one-time chain initialization..."
if [ -n "${skip_proto_flag}" ]; then
    env DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain init -y "${skip_proto_flag}"
else
    env DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain init -y
fi

if [ ! -f "${IGNITE_DEFAULT_HOME}/config/genesis.json" ]; then
    echo "[INIT] Initialization completed but genesis file is missing: ${IGNITE_DEFAULT_HOME}/config/genesis.json" >&2
    exit 1
fi

mkdir -p "$(dirname "${ENTRYPOINT_HOME}")"
rm -rf "${ENTRYPOINT_HOME}"
cp -a "${IGNITE_DEFAULT_HOME}" "${ENTRYPOINT_HOME}"

mkdir -p "${ENTRYPOINT_HOME}"
jq -n \
    --arg schema_version "${INIT_SCHEMA_VERSION}" \
    --arg init_hash "${expected_hash}" \
    --arg config_sha256 "${config_hash}" \
    --arg ignite_skip_proto "${skip_proto_normalized}" \
    --arg entrypointd_sha256 "${binary_hash}" \
    --arg created_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg ignite_version "$(ignite version 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]\\+/ /g; s/^ //; s/ $//')" \
    '{
      schema_version: $schema_version,
      init_hash: $init_hash,
      config_sha256: $config_sha256,
      ignite_skip_proto: $ignite_skip_proto,
      entrypointd_sha256: $entrypointd_sha256,
      created_at: $created_at,
      ignite_version: $ignite_version
    }' > "${STAMP_FILE}"

echo "[INIT] Chain home initialized successfully."
