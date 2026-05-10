#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
onchain_dir="$repo_root/cardano/onchain"
offenders=()

while IFS= read -r -d '' file; do
  while IFS= read -r match; do
    offenders+=("${file#$repo_root/}:$match")
  done < <(grep -nE '^[[:space:]]*use[[:space:]]+aiken/fuzz([[:space:].{]|$)' "$file" || true)
done < <(
  find "$onchain_dir" \
    -path "$onchain_dir/build" -prune \
    -o -type f -name '*.ak' ! -name '*.test.ak' -print0
)

if ((${#offenders[@]} > 0)); then
  {
    echo "aiken/fuzz imports are only allowed from *.test.ak files."
    printf '%s\n' "${offenders[@]}"
  } >&2
  exit 1
fi
