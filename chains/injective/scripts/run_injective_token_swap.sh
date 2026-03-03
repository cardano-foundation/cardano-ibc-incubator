#!/usr/bin/env bash
set -euo pipefail

check_string_empty() {
  [ -z "$1" ] && echo "$2" && exit 1
}

get_mock_token_denom() {
  local handler_file="$1"

  if [ ! -f "$handler_file" ]; then
    echo ""
    return 1
  fi

  local denom
  denom="$(jq -r '.tokens.mock // empty' "$handler_file" 2>/dev/null)"
  if [ -n "$denom" ] && [ "$denom" != "null" ]; then
    echo "$denom"
    return 0
  fi

  echo ""
  return 1
}

extract_channel_end_json_field() {
  local chain="$1"
  local channel="$2"
  local jq_expression="$3"

  "$HERMES_BIN" --json query channel end --chain "$chain" --port transfer --channel "$channel" 2>/dev/null |
    jq -r "select(.result) | ${jq_expression} // empty" 2>/dev/null |
    head -n 1
}

extract_counterparty_channel_id() {
  extract_channel_end_json_field "$1" "$2" '.result.remote.channel_id'
}

extract_channel_end_state() {
  extract_channel_end_json_field "$1" "$2" '.result.state'
}

is_open_channel_state() {
  [ "${1,,}" = "open" ]
}

get_latest_transfer_channel_id() {
  local channel_chain="$1"
  local counterparty_chain="$2"

  local channel_candidates
  channel_candidates=$(
    "$HERMES_BIN" --json query channels --chain "$channel_chain" --counterparty-chain "$counterparty_chain" 2>/dev/null |
      jq -r '
        select(.result) |
        (if (.result | type) == "array" then .result[] else .result end) |
        .channel_id // .channel_a // empty
      ' 2>/dev/null |
      sort -t- -k2,2nr
  )

  while IFS= read -r candidate_channel_id; do
    [ -z "$candidate_channel_id" ] && continue
    local candidate_state
    candidate_state="$(extract_channel_end_state "$channel_chain" "$candidate_channel_id")"
    if ! is_open_channel_state "$candidate_state"; then
      continue
    fi
    local counterparty_channel_id
    counterparty_channel_id="$(extract_counterparty_channel_id "$channel_chain" "$candidate_channel_id")"
    [ -z "$counterparty_channel_id" ] && continue
    local counterparty_state
    counterparty_state="$(extract_channel_end_state "$counterparty_chain" "$counterparty_channel_id")"
    if ! is_open_channel_state "$counterparty_state"; then
      continue
    fi
    local reverse_counterparty_channel_id
    reverse_counterparty_channel_id="$(extract_counterparty_channel_id "$counterparty_chain" "$counterparty_channel_id")"
    if [ "$reverse_counterparty_channel_id" = "$candidate_channel_id" ]; then
      echo "$candidate_channel_id"
      return 0
    fi
  done <<EOF
$channel_candidates
EOF

  echo ""
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
$(printf '%s\n' "$out" | grep -Eo '[0-9]+\.\.=[0-9]+')
EOF

  echo "$max_seq"
  return 0
}

channel_commitments_cleared() {
  local chain="$1"
  local channel="$2"
  local baseline_max_seq="$3"

  local current_max_seq
  current_max_seq="$(current_max_commitment_seq "$chain" "$channel" || true)"
  [ -z "$current_max_seq" ] && current_max_seq=0

  if [ "$current_max_seq" -le "$baseline_max_seq" ]; then
    return 0
  fi
  return 1
}

clear_packets_since_baseline() {
  local chain="$1"
  local channel="$2"
  local baseline_max_seq="$3"

  local current_max_seq
  current_max_seq="$(current_max_commitment_seq "$chain" "$channel" || true)"
  [ -z "$current_max_seq" ] && current_max_seq=0

  if [ "$current_max_seq" -le "$baseline_max_seq" ]; then
    return 0
  fi

  local from_seq=$((baseline_max_seq + 1))
  local sequence_range="${from_seq}..${current_max_seq}"
  run_with_timeout 180 "$HERMES_BIN" clear packets --chain "$chain" --port transfer --channel "$channel" --packet-sequences "$sequence_range"
}

wait_for_settlement() {
  local timeout_seconds="${1:-600}"
  local poll_interval="${2:-10}"
  local start_epoch
  start_epoch="$(date +%s)"
  local attempt=1

  while true; do
    local pending=0

    channel_commitments_cleared "$CARDANO_CHAIN_ID" "$cardano_entrypoint_channel_id" "$baseline_cardano_entrypoint_seq" || pending=1
    channel_commitments_cleared "$ENTRYPOINT_CHAIN_ID" "$entrypoint_injective_channel_id" "$baseline_entrypoint_injective_seq" || pending=1
    channel_commitments_cleared "$INJECTIVE_CHAIN_ID" "$injective_entrypoint_channel_id" "$baseline_injective_entrypoint_seq" || pending=1
    channel_commitments_cleared "$ENTRYPOINT_CHAIN_ID" "$entrypoint_cardano_channel_id" "$baseline_entrypoint_cardano_seq" || pending=1

    if [ "$pending" -eq 0 ]; then
      echo "All transfer packet commitments are cleared."
      return 0
    fi

    if [ $((attempt % 3)) -eq 0 ]; then
      clear_packets_since_baseline "$CARDANO_CHAIN_ID" "$cardano_entrypoint_channel_id" "$baseline_cardano_entrypoint_seq"
      clear_packets_since_baseline "$ENTRYPOINT_CHAIN_ID" "$entrypoint_injective_channel_id" "$baseline_entrypoint_injective_seq"
      clear_packets_since_baseline "$INJECTIVE_CHAIN_ID" "$injective_entrypoint_channel_id" "$baseline_injective_entrypoint_seq"
      clear_packets_since_baseline "$ENTRYPOINT_CHAIN_ID" "$entrypoint_cardano_channel_id" "$baseline_entrypoint_cardano_seq"
    fi

    local elapsed
    elapsed=$(( $(date +%s) - start_epoch ))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out after ${timeout_seconds}s waiting for Injective token swap settlement."
      return 1
    fi

    if [ $((attempt % 6)) -eq 0 ]; then
      echo "Still waiting for transfer settlement (${elapsed}s elapsed)..."
    fi

    sleep "$poll_interval"
    attempt=$((attempt + 1))
  done
}

script_dir="$(dirname "$(realpath "$0")")"
if [ -n "${CARIBIC_PROJECT_ROOT:-}" ]; then
  repo_root="$(realpath "$CARIBIC_PROJECT_ROOT")"
else
  repo_root="$(realpath "$script_dir/../../../")"
fi

INJECTIVE_DIR="${CARIBIC_INJECTIVE_DIR:-$(realpath "$script_dir/..")}"
HERMES_BIN="$repo_root/relayer/target/release/hermes"
INJECTIVE_COMPOSE_FILE="$INJECTIVE_DIR/configuration/docker-compose.yml"

if [ ! -x "$HERMES_BIN" ]; then
  echo "Local Hermes binary not found at $HERMES_BIN."
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes"
  exit 1
fi

if [ ! -f "$INJECTIVE_COMPOSE_FILE" ]; then
  echo "Injective compose file not found at $INJECTIVE_COMPOSE_FILE"
  exit 1
fi

CARDANO_CHAIN_ID="${CARDANO_CHAIN_ID:-cardano-devnet}"
ENTRYPOINT_CHAIN_ID="${ENTRYPOINT_CHAIN_ID:-entrypoint}"
INJECTIVE_CHAIN_ID="${INJECTIVE_CHAIN_ID:-injective-777}"
ENTRYPOINT_RECEIVER="${ENTRYPOINT_RECEIVER:-pfm}"
CARDANO_RECEIVER="${CARDANO_RECEIVER:-247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8}"
INJECTIVE_LOCAL_VALIDATOR_KEY="${INJECTIVE_LOCAL_VALIDATOR_KEY:-validator}"
SENT_AMOUNT_NUM="${CARIBIC_TOKEN_SWAP_AMOUNT:-12345}"
INJECTIVE_RETURN_AMOUNT="${INJECTIVE_RETURN_AMOUNT:-1000000000000000000}"
HANDLER_JSON="$repo_root/cardano/offchain/deployments/handler.json"
SENT_DENOM="$(get_mock_token_denom "$HANDLER_JSON")"
check_string_empty "$SENT_DENOM" "Could not resolve mock token denom from handler.json. Please ensure it exists."

cardano_entrypoint_channel_id="$(get_latest_transfer_channel_id "$CARDANO_CHAIN_ID" "$ENTRYPOINT_CHAIN_ID")"
check_string_empty "$cardano_entrypoint_channel_id" "Cardano->Entrypoint channel not found."
echo "Cardano->Entrypoint channel id: $cardano_entrypoint_channel_id"

entrypoint_cardano_channel_id="$(get_latest_transfer_channel_id "$ENTRYPOINT_CHAIN_ID" "$CARDANO_CHAIN_ID")"
check_string_empty "$entrypoint_cardano_channel_id" "Entrypoint->Cardano channel not found."
echo "Entrypoint->Cardano channel id: $entrypoint_cardano_channel_id"

entrypoint_injective_channel_id="$(get_latest_transfer_channel_id "$ENTRYPOINT_CHAIN_ID" "$INJECTIVE_CHAIN_ID")"
check_string_empty "$entrypoint_injective_channel_id" "Entrypoint->Injective channel not found."
echo "Entrypoint->Injective channel id: $entrypoint_injective_channel_id"

injective_entrypoint_channel_id="$(get_latest_transfer_channel_id "$INJECTIVE_CHAIN_ID" "$ENTRYPOINT_CHAIN_ID")"
check_string_empty "$injective_entrypoint_channel_id" "Injective->Entrypoint channel not found."
echo "Injective->Entrypoint channel id: $injective_entrypoint_channel_id"

baseline_cardano_entrypoint_seq="$(current_max_commitment_seq "$CARDANO_CHAIN_ID" "$cardano_entrypoint_channel_id" || true)"
[ -z "$baseline_cardano_entrypoint_seq" ] && baseline_cardano_entrypoint_seq=0
baseline_entrypoint_injective_seq="$(current_max_commitment_seq "$ENTRYPOINT_CHAIN_ID" "$entrypoint_injective_channel_id" || true)"
[ -z "$baseline_entrypoint_injective_seq" ] && baseline_entrypoint_injective_seq=0
baseline_injective_entrypoint_seq="$(current_max_commitment_seq "$INJECTIVE_CHAIN_ID" "$injective_entrypoint_channel_id" || true)"
[ -z "$baseline_injective_entrypoint_seq" ] && baseline_injective_entrypoint_seq=0
baseline_entrypoint_cardano_seq="$(current_max_commitment_seq "$ENTRYPOINT_CHAIN_ID" "$entrypoint_cardano_channel_id" || true)"
[ -z "$baseline_entrypoint_cardano_seq" ] && baseline_entrypoint_cardano_seq=0

INJECTIVE_RECEIVER="$(
  docker compose -f "$INJECTIVE_COMPOSE_FILE" exec -T injectived \
    injectived keys show "$INJECTIVE_LOCAL_VALIDATOR_KEY" -a --keyring-backend test --home /root/.injectived 2>/dev/null |
    tr -d '\r' | tail -n 1
)"
check_string_empty "$INJECTIVE_RECEIVER" "Unable to resolve Injective validator address from local container."
echo "Injective receiver address: $INJECTIVE_RECEIVER"

forward_to_injective_memo="$(
  jq -nc \
    --arg receiver "$INJECTIVE_RECEIVER" \
    --arg channel "$entrypoint_injective_channel_id" \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)"

echo "Submitting Cardano->Entrypoint->Injective transfer..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$CARDANO_CHAIN_ID" \
  --dst-chain "$ENTRYPOINT_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$cardano_entrypoint_channel_id" \
  --amount "$SENT_AMOUNT_NUM" \
  --denom "$SENT_DENOM" \
  --receiver "$ENTRYPOINT_RECEIVER" \
  --timeout-seconds 3600 \
  --memo "$forward_to_injective_memo"

forward_to_cardano_memo="$(
  jq -nc \
    --arg receiver "$CARDANO_RECEIVER" \
    --arg channel "$entrypoint_cardano_channel_id" \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)"

echo "Submitting Injective->Entrypoint->Cardano return leg..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$INJECTIVE_CHAIN_ID" \
  --dst-chain "$ENTRYPOINT_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$injective_entrypoint_channel_id" \
  --amount "$INJECTIVE_RETURN_AMOUNT" \
  --denom "inj" \
  --receiver "$ENTRYPOINT_RECEIVER" \
  --timeout-seconds 3600 \
  --memo "$forward_to_cardano_memo"

echo "Waiting for transfer settlement..."
wait_for_settlement 600 10
echo "Injective token swap flow done."
