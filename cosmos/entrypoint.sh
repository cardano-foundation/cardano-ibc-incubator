#!/bin/bash

set -euo pipefail

if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

export PATH="/root/.ignite/bin:/go/bin:/usr/local/go/bin:${PATH}"
cd /root/entrypoint/workspace/entrypoint

skip_proto_value="${IGNITE_SKIP_PROTO:-1}"
skip_proto_normalized="${skip_proto_value,,}"
skip_proto_flag=""

case "${skip_proto_normalized}" in
    1|true|yes|y|on)
        skip_proto_flag="--skip-proto"
        ;;
    0|false|no|n|off)
        skip_proto_flag=""
        ;;
    *)
        echo "[ENTRYPOINT] IGNITE_SKIP_PROTO='${skip_proto_value}' is invalid; defaulting to --skip-proto" >&2
        skip_proto_flag="--skip-proto"
        ;;
esac

echo "[ENTRYPOINT] ignite=$(command -v ignite) buf=$(command -v buf) protoc-gen-openapiv2=$(command -v protoc-gen-openapiv2)"
echo "[ENTRYPOINT] BUF_GENERATE_TIMEOUT=${BUF_GENERATE_TIMEOUT:-10m} IGNITE_SKIP_PROTO=${skip_proto_value}"

if [ -n "${skip_proto_flag}" ]; then
    exec env DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain serve -y -v "${skip_proto_flag}"
else
    exec env DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain serve -y -v
fi
