#!/usr/bin/env sh
set -eu

RUNNER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ELF_PATH="$RUNNER_DIR/../../../third_party/ibc-eureka/sp1-programs-v2.0.0/sp1-ics07-tendermint-update-client"
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

[ -f "$ELF_PATH" ]
[ "$(hash_file "$ELF_PATH")" = "$ELF_SHA256" ]

cd "$RUNNER_DIR"
cargo run --release --locked -- "$ELF_PATH" "$FIXTURE_SOURCE" "$@"
