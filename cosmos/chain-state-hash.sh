#!/usr/bin/env bash

set -euo pipefail

INIT_SCHEMA_VERSION="${INIT_SCHEMA_VERSION:-1}"
CHAIN_WORKDIR="${CHAIN_WORKDIR:-/root/entrypoint/workspace/entrypoint}"
ENTRYPOINT_HOME="${ENTRYPOINT_HOME:-/root/.entrypoint-data/node}"
STAMP_FILE="${STAMP_FILE:-${ENTRYPOINT_HOME}/.caribic-init-stamp.json}"
GENESIS_FILE="${GENESIS_FILE:-${ENTRYPOINT_HOME}/config/genesis.json}"

normalize_skip_proto_value() {
    local raw_value="${1:-1}"
    local normalized_value
    normalized_value="$(echo "${raw_value}" | tr '[:upper:]' '[:lower:]')"

    case "${normalized_value}" in
        1|true|yes|y|on)
            echo "1"
            ;;
        0|false|no|n|off)
            echo "0"
            ;;
        *)
            echo "1"
            ;;
    esac
}

resolve_entrypointd_binary() {
    if command -v entrypointd >/dev/null 2>&1; then
        command -v entrypointd
        return 0
    fi

    if [ -x "${CHAIN_WORKDIR}/build/entrypointd" ]; then
        echo "${CHAIN_WORKDIR}/build/entrypointd"
        return 0
    fi

    return 1
}

entrypointd_sha256_or_missing() {
    local binary_path
    if binary_path="$(resolve_entrypointd_binary 2>/dev/null)"; then
        sha256sum "${binary_path}" | awk '{print $1}'
    else
        echo "missing"
    fi
}

config_sha256() {
    local config_path="${CHAIN_WORKDIR}/config.yml"
    if [ ! -f "${config_path}" ]; then
        echo ""
        return 1
    fi

    sha256sum "${config_path}" | awk '{print $1}'
}

compute_expected_init_hash() {
    local normalized_skip_proto
    local config_hash
    local binary_hash

    normalized_skip_proto="$(normalize_skip_proto_value "${IGNITE_SKIP_PROTO:-1}")"
    config_hash="$(config_sha256)"
    binary_hash="$(entrypointd_sha256_or_missing)"

    printf '%s\n' \
        "schema=${INIT_SCHEMA_VERSION}" \
        "config_sha256=${config_hash}" \
        "ignite_skip_proto=${normalized_skip_proto}" \
        "entrypointd_sha256=${binary_hash}" \
        | sha256sum | awk '{print $1}'
}
