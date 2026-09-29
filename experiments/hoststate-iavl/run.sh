#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p artifacts
export GOWORK=off
go test -v . > artifacts/go-results.txt
go run .
aiken check -t silent > artifacts/aiken-results.json
aiken build -t silent
deno run --frozen --allow-read --allow-write --allow-env --allow-net transactions.ts > artifacts/transaction-run.log 2>&1
python3 report.py
