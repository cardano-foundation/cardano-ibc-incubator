#!/usr/bin/env bash

set -Eeuo pipefail

require_value() {
  if [[ -z "$1" ]]; then
    echo "$2" >&2
    exit 1
  fi
}

current_max_commitment_seq() {
  local chain="$1"
  local channel="$2"
  local output
  output="$("$HERMES_BIN" query packet commitments --chain "$chain" --port transfer --channel "$channel" 2>&1)" || {
    echo "0"
    return 1
  }

  local max_seq=0
  local range
  while IFS= read -r range; do
    [[ -z "$range" ]] && continue
    local range_end="${range##*..=}"
    if (( range_end > max_seq )); then
      max_seq="$range_end"
    fi
  done < <(printf '%s\n' "$output" | grep -Eo '[0-9]+\.\.=[0-9]+' || true)
  echo "$max_seq"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$@" >/dev/null 2>&1 &
  local command_pid=$!
  (
    sleep "$timeout_seconds"
    kill "$command_pid" >/dev/null 2>&1 || true
  ) >/dev/null 2>&1 &
  local watchdog_pid=$!
  wait "$command_pid" >/dev/null 2>&1 || true
  kill "$watchdog_pid" >/dev/null 2>&1 || true
}

clear_packets_since_baseline() {
  local chain="$1"
  local channel="$2"
  local baseline="$3"
  local current
  current="$(current_max_commitment_seq "$chain" "$channel" || true)"
  [[ -n "$current" ]] || current=0
  (( current <= baseline )) && return 0

  local sequence_range="$((baseline + 1))..${current}"
  echo "Clearing packet commitments on ${chain}/${channel} (${sequence_range})..."
  run_with_timeout 360 "$HERMES_BIN" clear packets \
    --chain "$chain" \
    --port transfer \
    --channel "$channel" \
    --packet-sequences "$sequence_range"
}

wait_for_commitments_cleared() {
  local timeout_seconds="${1:-900}"
  local poll_interval="${2:-10}"
  local start_epoch
  start_epoch="$(date +%s)"
  local attempt=1

  while true; do
    local cardano_current cosmos_current
    cardano_current="$(current_max_commitment_seq "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID" || true)"
    cosmos_current="$(current_max_commitment_seq "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID" || true)"
    [[ -n "$cardano_current" ]] || cardano_current=0
    [[ -n "$cosmos_current" ]] || cosmos_current=0

    if (( cardano_current <= BASELINE_CARDANO_SEQ && cosmos_current <= BASELINE_COSMOS_SEQ )); then
      echo "All direct ${COSMOS_PROFILE} packet commitments are cleared."
      return 0
    fi

    if (( attempt % 3 == 0 )); then
      clear_packets_since_baseline "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID" "$BASELINE_CARDANO_SEQ"
      clear_packets_since_baseline "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID" "$BASELINE_COSMOS_SEQ"
    fi

    if (( $(date +%s) - start_epoch >= timeout_seconds )); then
      echo "Timed out after ${timeout_seconds}s waiting for ${COSMOS_PROFILE} demo settlement." >&2
      "$HERMES_BIN" query packet pending --chain "$CARDANO_CHAIN_ID" --port transfer --channel "$CARDANO_COSMOS_CHANNEL_ID" || true
      "$HERMES_BIN" query packet pending --chain "$COSMOS_CHAIN_ID" --port transfer --channel "$COSMOS_CARDANO_CHANNEL_ID" || true
      return 1
    fi

    sleep "$poll_interval"
    attempt=$((attempt + 1))
  done
}

script_dir="$(dirname "$(realpath "$0")")"
repo_root="${CARIBIC_PROJECT_ROOT:-$(realpath "$script_dir/../../..")}"
HERMES_BIN="$repo_root/relayer/target/release/hermes"

[[ -x "$HERMES_BIN" ]] || {
  echo "Local Hermes binary not found at $HERMES_BIN." >&2
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes" >&2
  exit 1
}

COSMOS_PROFILE="${COSMOS_PROFILE:-v8-classic}"
CARDANO_CHAIN_ID="${CARDANO_CHAIN_ID:-cardano-devnet}"
COSMOS_CHAIN_ID="${COSMOS_CHAIN_ID:-v8-classic-1}"
CARDANO_COSMOS_CHANNEL_ID="${CARDANO_COSMOS_CHANNEL_ID:-}"
COSMOS_CARDANO_CHANNEL_ID="${COSMOS_CARDANO_CHANNEL_ID:-}"
CARDANO_RECEIVER="${CARDANO_RECEIVER:-247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8}"
CARDANO_SEND_AMOUNT="${CARIBIC_TOKEN_SWAP_AMOUNT:-12345}"
COSMOS_RETURN_AMOUNT="${COSMOS_RETURN_AMOUNT:-12345}"
COSMOS_RETURN_DENOM="${COSMOS_RETURN_DENOM:-utest}"
HANDLER_JSON="${HANDLER_JSON:-$repo_root/cardano/offchain/deployments/handler.json}"

require_value "$CARDANO_COSMOS_CHANNEL_ID" "CARDANO_COSMOS_CHANNEL_ID is required."
require_value "$COSMOS_CARDANO_CHANNEL_ID" "COSMOS_CARDANO_CHANNEL_ID is required."
[[ -f "$HANDLER_JSON" ]] || {
  echo "Could not find Cardano handler deployment at $HANDLER_JSON." >&2
  exit 1
}

CARDANO_SEND_DENOM="$(jq -r '.tokens.mock // empty' "$HANDLER_JSON" | head -n 1)"
require_value "$CARDANO_SEND_DENOM" "Could not resolve the Cardano mock token denom from handler.json."

key_output="$("$HERMES_BIN" keys list --chain "$COSMOS_CHAIN_ID" 2>/dev/null || true)"
COSMOS_RECEIVER="$(printf '%s\n' "$key_output" | grep -Eo 'cosmos1[0-9a-z]{38}' | head -n 1 || true)"
require_value "$COSMOS_RECEIVER" "Unable to resolve the funded Hermes receiver for ${COSMOS_CHAIN_ID}."

BASELINE_CARDANO_SEQ="$(current_max_commitment_seq "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID" || true)"
BASELINE_COSMOS_SEQ="$(current_max_commitment_seq "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID" || true)"
[[ -n "$BASELINE_CARDANO_SEQ" ]] || BASELINE_CARDANO_SEQ=0
[[ -n "$BASELINE_COSMOS_SEQ" ]] || BASELINE_COSMOS_SEQ=0

echo "Submitting Cardano -> ${COSMOS_PROFILE} Classic transfer..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$CARDANO_CHAIN_ID" \
  --dst-chain "$COSMOS_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$CARDANO_COSMOS_CHANNEL_ID" \
  --amount "$CARDANO_SEND_AMOUNT" \
  --denom "$CARDANO_SEND_DENOM" \
  --receiver "$COSMOS_RECEIVER" \
  --timeout-seconds 3600

clear_packets_since_baseline "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID" "$BASELINE_CARDANO_SEQ"

echo "Submitting ${COSMOS_PROFILE} -> Cardano Classic return transfer..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$COSMOS_CHAIN_ID" \
  --dst-chain "$CARDANO_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$COSMOS_CARDANO_CHANNEL_ID" \
  --amount "$COSMOS_RETURN_AMOUNT" \
  --denom "$COSMOS_RETURN_DENOM" \
  --receiver "$CARDANO_RECEIVER" \
  --timeout-seconds 3600

clear_packets_since_baseline "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID" "$BASELINE_COSMOS_SEQ"
wait_for_commitments_cleared 900 10

echo "Direct Cardano-to-${COSMOS_PROFILE} Classic compatibility demo completed."
