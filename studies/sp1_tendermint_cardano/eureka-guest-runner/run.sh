#!/usr/bin/env sh
set -eu

RUNNER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ELF_DIR="$RUNNER_DIR/.cache"
ELF_PATH="$ELF_DIR/sp1-ics07-tendermint-update-client"
ELF_TMP="$ELF_PATH.tmp"
ELF_URL="https://github.com/cosmos/ibc-contracts/releases/download/sp1-programs-v2.0.0/sp1-ics07-tendermint-update-client"
ELF_SHA256="6a6a40df2b1339455de7b238fdf3e914f4c2f99e85b8fc4abb65fb1664f42270"
if [ "$#" -gt 0 ]; then
  FIXTURE_SOURCE=$1
  shift
else
  FIXTURE_SOURCE="$RUNNER_DIR/../../../cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity/source"
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

mkdir -p "$ELF_DIR"
if [ ! -f "$ELF_PATH" ] || [ "$(hash_file "$ELF_PATH")" != "$ELF_SHA256" ]; then
  trap 'rm -f "$ELF_TMP"' EXIT HUP INT TERM
  curl --fail --location --silent --show-error "$ELF_URL" --output "$ELF_TMP"
  [ "$(hash_file "$ELF_TMP")" = "$ELF_SHA256" ]
  mv "$ELF_TMP" "$ELF_PATH"
  trap - EXIT HUP INT TERM
fi

cd "$RUNNER_DIR"
cargo run --release --locked -- "$ELF_PATH" "$FIXTURE_SOURCE" "$@"
