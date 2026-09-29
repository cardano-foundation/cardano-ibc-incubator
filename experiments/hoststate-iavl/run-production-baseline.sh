#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
experiment_dir="$PWD"
mkdir -p artifacts
baseline_lock="$(mktemp)"
trap 'rm -f "$baseline_lock"' EXIT
cp ../../cardano/offchain/deno.lock "$baseline_lock"
cd ../../cardano/onchain
aiken build -t silent
cd ../offchain
deno test --lock="$baseline_lock" --allow-env --allow-read \
  --filter '/(First native SendPacket|ChanOpenInit|ChanOpenTry)/' \
  src/packet-budgets.test.ts > "$experiment_dir/artifacts/production-budgets.log" 2>&1
cd "$experiment_dir"
python3 report.py
