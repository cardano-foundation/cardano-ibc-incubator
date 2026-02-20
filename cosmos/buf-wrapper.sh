#!/bin/bash

set -euo pipefail

REAL_BUF_BIN="/go/bin/buf.real"
DEFAULT_TIMEOUT="${BUF_GENERATE_TIMEOUT:-10m}"

if [ ! -x "${REAL_BUF_BIN}" ]; then
    echo "[BUF WRAPPER] Missing ${REAL_BUF_BIN}" >&2
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
