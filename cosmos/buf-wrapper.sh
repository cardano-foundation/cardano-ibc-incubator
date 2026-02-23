#!/bin/bash

set -euo pipefail

SELF_PATH="$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")"
REAL_BUF_BIN="${BUF_REAL_BIN:-/go/bin/buf.real}"
DEFAULT_TIMEOUT="${BUF_GENERATE_TIMEOUT:-10m}"

if [ ! -x "${REAL_BUF_BIN}" ]; then
    for candidate in /go/bin/buf /root/.ignite/bin/buf /usr/local/bin/buf /usr/bin/buf; do
        candidate_path="$(readlink -f "${candidate}" 2>/dev/null || printf '%s' "${candidate}")"
        if [ -x "${candidate}" ] && [ "${candidate_path}" != "${SELF_PATH}" ]; then
            REAL_BUF_BIN="${candidate}"
            break
        fi
    done
fi

if [ ! -x "${REAL_BUF_BIN}" ]; then
    echo "[BUF WRAPPER] Missing buf binary. Tried /go/bin/buf.real and fallback locations." >&2
    exit 127
fi

if [ "${1:-}" = "generate" ]; then
    for arg in "$@"; do
        if [ "$arg" = "--timeout" ]; then
            exec "${REAL_BUF_BIN}" "$@"
        fi
    done

    exec "${REAL_BUF_BIN}" "$@" --timeout "${DEFAULT_TIMEOUT}"
fi

exec "${REAL_BUF_BIN}" "$@"
