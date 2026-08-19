#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
core_dir="$repo_root/cardano/onchain/lib/ibc/core"
offenders=()

while IFS= read -r -d '' file; do
  while IFS= read -r match; do
    offenders+=("${file#$repo_root/}:$match")
  done < <(grep -nE '^[[:space:]]*use[[:space:]]+ibc/apps/' "$file" || true)
done < <(find "$core_dir" -type f -name '*.ak' -print0)

if ((${#offenders[@]} > 0)); then
  {
    echo "Core IBC modules must not import application modules."
    printf '%s\n' "${offenders[@]}"
  } >&2
  exit 1
fi
