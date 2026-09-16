#!/usr/bin/env bash
set -euo pipefail

mode="${1:---check}"
if [[ "$#" -gt 1 || ( "$mode" != --check && "$mode" != --write ) ]]; then
  echo "Usage: $0 [--check|--write]" >&2
  exit 2
fi
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
vector_output="$repo_root/cardano/onchain/lib/ibc/core/domain_protobuf_vectors.test.ak"
vector_temp="$(mktemp)"
trap 'rm -f "$vector_temp"' EXIT

cd "$repo_root/cosmos/cardano-probabilistic-light-client-v10"
GOTOOLCHAIN=go1.25.13 go run ../../tests/domain-protobuf-vectors/main.go |
  aiken fmt --stdin > "$vector_temp"
if [[ "$mode" == --write ]]; then
  cp "$vector_temp" "$vector_output"
else
  diff -u "$vector_output" "$vector_temp"
fi
