#!/usr/bin/env bash
set -Eeuo pipefail

check_string_empty() {
  if [ -z "$1" ]; then
    echo "$2"
    exit 1
  fi
}

extract_first_injective_address() {
  grep -Eo 'inj1[0-9a-z]{38}' | head -n 1
}

get_mock_token_denom() {
  local handler_file="$1"
  [ -f "$handler_file" ] || return 1
  jq -r '.tokens.mock // empty' "$handler_file" 2>/dev/null | head -n 1
}

current_max_commitment_seq() {
  local chain="$1"
  local channel="$2"
  local out
  out="$("$HERMES_BIN" query packet commitments --chain "$chain" --port transfer --channel "$channel" 2>&1)" || {
    echo "0"
    return 1
  }

  local max_seq=0
  while IFS= read -r range; do
    [ -z "$range" ] && continue
    local range_end="${range##*..=}"
    if [ "$range_end" -gt "$max_seq" ]; then
      max_seq="$range_end"
    fi
  done <<EOF
$(printf '%s\n' "$out" | grep -Eo '[0-9]+\.\.=[0-9]+' || true)
EOF
  echo "$max_seq"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$@" >/dev/null 2>&1 &
  local cmd_pid=$!
  (
    sleep "$timeout_seconds"
    kill "$cmd_pid" >/dev/null 2>&1 || true
  ) &
  local watchdog_pid=$!
  wait "$cmd_pid" >/dev/null 2>&1 || true
  kill "$watchdog_pid" >/dev/null 2>&1 || true
}

clear_packets_since_baseline() {
  local chain="$1"
  local channel="$2"
  local baseline="$3"
  local current
  current="$(current_max_commitment_seq "$chain" "$channel" || true)"
  [ -n "$current" ] || current=0
  [ "$current" -le "$baseline" ] && return 0

  local from_seq=$((baseline + 1))
  local sequence_range="${from_seq}..${current}"
  echo "Clearing packet commitments on ${chain}/${channel} (${sequence_range})..."
  run_with_timeout 180 "$HERMES_BIN" clear packets --chain "$chain" --port transfer --channel "$channel" --packet-sequences "$sequence_range"
}

wait_for_commitments_cleared() {
  local timeout_seconds="${1:-900}"
  local poll_interval="${2:-10}"
  local start_epoch
  start_epoch=$(date +%s)
  local attempt=1

  while true; do
    local cardano_current injective_current
    cardano_current="$(current_max_commitment_seq "$CARDANO_CHAIN_ID" "$CARDANO_INJECTIVE_CHANNEL_ID" || true)"
    injective_current="$(current_max_commitment_seq "$INJECTIVE_CHAIN_ID" "$INJECTIVE_CARDANO_CHANNEL_ID" || true)"
    [ -n "$cardano_current" ] || cardano_current=0
    [ -n "$injective_current" ] || injective_current=0

    if [ "$cardano_current" -le "$BASELINE_CARDANO_INJECTIVE_SEQ" ] && [ "$injective_current" -le "$BASELINE_INJECTIVE_CARDANO_SEQ" ]; then
      echo "All direct Injective packet commitments are cleared."
      return 0
    fi

    if [ $((attempt % 3)) -eq 0 ]; then
      clear_packets_since_baseline "$CARDANO_CHAIN_ID" "$CARDANO_INJECTIVE_CHANNEL_ID" "$BASELINE_CARDANO_INJECTIVE_SEQ"
      clear_packets_since_baseline "$INJECTIVE_CHAIN_ID" "$INJECTIVE_CARDANO_CHANNEL_ID" "$BASELINE_INJECTIVE_CARDANO_SEQ"
    fi

    local elapsed=$(( $(date +%s) - start_epoch ))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out after ${timeout_seconds}s waiting for direct Injective demo settlement."
      "$HERMES_BIN" query packet pending --chain "$CARDANO_CHAIN_ID" --port transfer --channel "$CARDANO_INJECTIVE_CHANNEL_ID" || true
      "$HERMES_BIN" query packet pending --chain "$INJECTIVE_CHAIN_ID" --port transfer --channel "$INJECTIVE_CARDANO_CHANNEL_ID" || true
      return 1
    fi

    sleep "$poll_interval"
    attempt=$((attempt + 1))
  done
}

script_dir="$(dirname "$(realpath "$0")")"
repo_root="${CARIBIC_PROJECT_ROOT:-$(realpath "$script_dir/../../../")}"
INJECTIVE_DIR="${CARIBIC_INJECTIVE_DIR:-$(realpath "$script_dir/..")}"
HERMES_BIN="$repo_root/relayer/target/release/hermes"
INJECTIVE_COMPOSE_FILE="$INJECTIVE_DIR/configuration/docker-compose.yml"

[ -x "$HERMES_BIN" ] || {
  echo "Local Hermes binary not found at $HERMES_BIN."
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes"
  exit 1
}

CARDANO_CHAIN_ID="${CARDANO_CHAIN_ID:-cardano-devnet}"
INJECTIVE_CHAIN_ID="${INJECTIVE_CHAIN_ID:-injective-777}"
INJECTIVE_NETWORK="${INJECTIVE_NETWORK:-local}"
CARDANO_INJECTIVE_CHANNEL_ID="${CARDANO_INJECTIVE_CHANNEL_ID:-}"
INJECTIVE_CARDANO_CHANNEL_ID="${INJECTIVE_CARDANO_CHANNEL_ID:-}"
CARDANO_RECEIVER="${CARDANO_RECEIVER:-247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8}"
INJECTIVE_LOCAL_VALIDATOR_KEY="${INJECTIVE_LOCAL_VALIDATOR_KEY:-validator}"
SENT_AMOUNT_NUM="${CARIBIC_TOKEN_SWAP_AMOUNT:-12345}"
INJECTIVE_RETURN_AMOUNT="${INJECTIVE_RETURN_AMOUNT:-1000000000000000000}"
HANDLER_JSON="${HANDLER_JSON:-$repo_root/cardano/offchain/deployments/handler.json}"
SENT_DENOM="$(get_mock_token_denom "$HANDLER_JSON" || true)"

check_string_empty "$CARDANO_INJECTIVE_CHANNEL_ID" "CARDANO_INJECTIVE_CHANNEL_ID is required."
check_string_empty "$INJECTIVE_CARDANO_CHANNEL_ID" "INJECTIVE_CARDANO_CHANNEL_ID is required."
check_string_empty "$SENT_DENOM" "Could not resolve mock token denom from handler.json."

INJECTIVE_RECEIVER="$(printf '%s' "${INJECTIVE_RECEIVER:-}" | tr -d '\r' | tail -n 1)"
if [ -z "$INJECTIVE_RECEIVER" ]; then
  if [ "$INJECTIVE_NETWORK" = "local" ]; then
    INJECTIVE_RECEIVER="$(
      docker compose -f "$INJECTIVE_COMPOSE_FILE" exec -T injectived \
        injectived keys show "$INJECTIVE_LOCAL_VALIDATOR_KEY" -a --keyring-backend test --home /root/.injectived 2>/dev/null |
        tr -d '\r' | tail -n 1
    )" || true
  else
    key_list_output="$("$HERMES_BIN" keys list --chain "$INJECTIVE_CHAIN_ID" 2>/dev/null || true)"
    INJECTIVE_RECEIVER="$(printf '%s\n' "$key_list_output" | extract_first_injective_address || true)"
  fi
fi
check_string_empty "$INJECTIVE_RECEIVER" "Unable to resolve Injective receiver address."
echo "Injective receiver address: $INJECTIVE_RECEIVER"

BASELINE_CARDANO_INJECTIVE_SEQ="$(current_max_commitment_seq "$CARDANO_CHAIN_ID" "$CARDANO_INJECTIVE_CHANNEL_ID" || true)"
BASELINE_INJECTIVE_CARDANO_SEQ="$(current_max_commitment_seq "$INJECTIVE_CHAIN_ID" "$INJECTIVE_CARDANO_CHANNEL_ID" || true)"
[ -n "$BASELINE_CARDANO_INJECTIVE_SEQ" ] || BASELINE_CARDANO_INJECTIVE_SEQ=0
[ -n "$BASELINE_INJECTIVE_CARDANO_SEQ" ] || BASELINE_INJECTIVE_CARDANO_SEQ=0

echo "Submitting direct Cardano->Injective transfer..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$CARDANO_CHAIN_ID" \
  --dst-chain "$INJECTIVE_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$CARDANO_INJECTIVE_CHANNEL_ID" \
  --amount "$SENT_AMOUNT_NUM" \
  --denom "$SENT_DENOM" \
  --receiver "$INJECTIVE_RECEIVER" \
  --timeout-seconds 3600

clear_packets_since_baseline "$CARDANO_CHAIN_ID" "$CARDANO_INJECTIVE_CHANNEL_ID" "$BASELINE_CARDANO_INJECTIVE_SEQ"

echo "Submitting direct Injective->Cardano return transfer..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$INJECTIVE_CHAIN_ID" \
  --dst-chain "$CARDANO_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$INJECTIVE_CARDANO_CHANNEL_ID" \
  --amount "$INJECTIVE_RETURN_AMOUNT" \
  --denom "inj" \
  --receiver "$CARDANO_RECEIVER" \
  --timeout-seconds 3600

clear_packets_since_baseline "$INJECTIVE_CHAIN_ID" "$INJECTIVE_CARDANO_CHANNEL_ID" "$BASELINE_INJECTIVE_CARDANO_SEQ"
wait_for_commitments_cleared 900 10
echo "Direct Cardano-to-Injective token transfer demo completed."
