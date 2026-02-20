#!/bin/bash

set -euo pipefail

source "$HOME/.bashrc"
export PATH="/root/.ignite/bin:/go/bin:/usr/local/go/bin:${PATH}"
cd /root/entrypoint/workspace/entrypoint

for binary in ignite buf protoc-gen-openapiv2; do
    if ! command -v "$binary" >/dev/null 2>&1; then
        echo "[ENTRYPOINT] Missing required binary in PATH: $binary"
        echo "[ENTRYPOINT] PATH=$PATH"
        exit 127
    fi
done

echo "[ENTRYPOINT] ignite=$(command -v ignite) buf=$(command -v buf) protoc-gen-openapiv2=$(command -v protoc-gen-openapiv2)"
echo "[ENTRYPOINT] BUF_GENERATE_TIMEOUT=${BUF_GENERATE_TIMEOUT:-10m}"
exec env DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain serve -y -v
