#!/usr/bin/env bash
set -euo pipefail

tracked_generated_paths=(
  "proto-types/src"
  "cardano/onchain/plutus.json"
  "cardano/onchain/build/aiken-compile.lock"
)

git update-index -q --refresh

if ! git diff --exit-code -- "${tracked_generated_paths[@]}"; then
  cat >&2 <<'EOF'
Generated artifacts are stale.

Run proto-types codegen and the Aiken build locally, then commit the resulting generated changes.
EOF
  exit 1
fi
