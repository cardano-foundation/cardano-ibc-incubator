#!/usr/bin/env bash
set -Eeuo pipefail

on_error() {
  local exit_code="$1"
  local line_no="$2"
  local command="$3"
  echo "ERROR: run_injective_token_swap.sh failed at line ${line_no}: ${command} (exit ${exit_code})" >&2
}

trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

SETTLEMENT_CLEAR_TIMEOUT_SECS="${SETTLEMENT_CLEAR_TIMEOUT_SECS:-120}"
SETTLEMENT_PROGRESS_EVERY_N_POLLS="${SETTLEMENT_PROGRESS_EVERY_N_POLLS:-2}"
TRANSFER_SUBMIT_TIMEOUT_SECS="${TRANSFER_SUBMIT_TIMEOUT_SECS:-300}"

check_string_empty() {
  if [ -z "$1" ]; then
    echo "$2"
    exit 1
  fi
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
    if [ -z "$candidate_channel_id" ]; then
      continue
    fi
    local candidate_state
    candidate_state="$(extract_channel_end_state "$channel_chain" "$candidate_channel_id")"
    if ! is_open_channel_state "$candidate_state"; then
      continue
    fi
    local counterparty_channel_id
    counterparty_channel_id="$(extract_counterparty_channel_id "$channel_chain" "$candidate_channel_id")"
    if [ -z "$counterparty_channel_id" ]; then
      continue
    fi
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
  local description="$1"
  shift
  local output_file
  output_file="$(mktemp)"
  local timeout_file
  timeout_file="$(mktemp)"
  rm -f "$timeout_file"

  "$@" >"$output_file" 2>&1 &
  local cmd_pid=$!

  (
    sleep "$timeout_seconds"
    if kill -0 "$cmd_pid" >/dev/null 2>&1; then
      echo "timeout" >"$timeout_file"
      kill "$cmd_pid" >/dev/null 2>&1 || true
    fi
  ) >/dev/null 2>&1 &
  local watchdog_pid=$!

  local cmd_status
  if wait "$cmd_pid"; then
    cmd_status=0
  else
    cmd_status=$?
  fi

  kill "$watchdog_pid" >/dev/null 2>&1 || true
  wait "$watchdog_pid" >/dev/null 2>&1 || true

  if [ -s "$timeout_file" ]; then
    echo "WARNING: ${description} timed out after ${timeout_seconds}s."
    if [ -s "$output_file" ]; then
      echo "Last command output:"
      tail -n 20 "$output_file"
    fi
    rm -f "$output_file" "$timeout_file"
    return 124
  fi

  if [ "$cmd_status" -ne 0 ]; then
    echo "WARNING: ${description} failed with exit ${cmd_status}."
    if [ -s "$output_file" ]; then
      echo "Last command output:"
      tail -n 20 "$output_file"
    fi
    rm -f "$output_file" "$timeout_file"
    return "$cmd_status"
  fi

  rm -f "$output_file" "$timeout_file"
  return 0
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
    if [ -z "$range" ]; then
      continue
    fi
    local range_end="${range##*..=}"
    if [ "$range_end" -gt "$max_seq" ]; then
      max_seq="$range_end"
    fi
  done <<EOF
$(printf '%s\n' "$out" | grep -Eo '[0-9]+\.\.=[0-9]+' || true)
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
  if [ -z "$current_max_seq" ]; then
    current_max_seq=0
  fi

  if [ "$current_max_seq" -le "$baseline_max_seq" ]; then
    return 0
  fi
  return 1
}

outstanding_commitment_count() {
  local chain="$1"
  local channel="$2"
  local baseline_max_seq="$3"

  local current_max_seq
  current_max_seq="$(current_max_commitment_seq "$chain" "$channel" || true)"
  if [ -z "$current_max_seq" ]; then
    current_max_seq=0
  fi

  if [ "$current_max_seq" -le "$baseline_max_seq" ]; then
    echo "0"
    return 0
  fi

  echo "$((current_max_seq - baseline_max_seq))"
}

clear_packets_since_baseline() {
  local chain="$1"
  local channel="$2"
  local baseline_max_seq="$3"

  local current_max_seq
  current_max_seq="$(current_max_commitment_seq "$chain" "$channel" || true)"
  if [ -z "$current_max_seq" ]; then
    current_max_seq=0
  fi

  if [ "$current_max_seq" -le "$baseline_max_seq" ]; then
    return 0
  fi

  local from_seq=$((baseline_max_seq + 1))
  local sequence_range="${from_seq}..${current_max_seq}"
  echo "Clearing packet commitments on ${chain}/${channel} (range ${sequence_range})..."
  if run_with_timeout \
    "$SETTLEMENT_CLEAR_TIMEOUT_SECS" \
    "Hermes clear packets on ${chain}/${channel} (${sequence_range})" \
    "$HERMES_BIN" clear packets --chain "$chain" --port transfer --channel "$channel" --packet-sequences "$sequence_range"; then
    echo "Packet clear finished on ${chain}/${channel}."
  else
    echo "Continuing settlement checks despite clear failure on ${chain}/${channel}."
  fi
}

wait_for_settlement() {
  local timeout_seconds="${1:-600}"
  local poll_interval="${2:-10}"
  local start_epoch
  start_epoch="$(date +%s)"
  local attempt=1

  while true; do
    local pending_cardano_entrypoint
    local pending_entrypoint_injective
    local pending_injective_entrypoint
    local pending_entrypoint_cardano

    pending_cardano_entrypoint="$(outstanding_commitment_count "$CARDANO_CHAIN_ID" "$cardano_entrypoint_channel_id" "$baseline_cardano_entrypoint_seq")"
    pending_entrypoint_injective="$(outstanding_commitment_count "$ENTRYPOINT_CHAIN_ID" "$entrypoint_injective_channel_id" "$baseline_entrypoint_injective_seq")"
    pending_injective_entrypoint="$(outstanding_commitment_count "$INJECTIVE_CHAIN_ID" "$injective_entrypoint_channel_id" "$baseline_injective_entrypoint_seq")"
    pending_entrypoint_cardano="$(outstanding_commitment_count "$ENTRYPOINT_CHAIN_ID" "$entrypoint_cardano_channel_id" "$baseline_entrypoint_cardano_seq")"

    local pending_total
    pending_total=$((pending_cardano_entrypoint + pending_entrypoint_injective + pending_injective_entrypoint + pending_entrypoint_cardano))

    local elapsed
    elapsed=$(( $(date +%s) - start_epoch ))

    if [ "$pending_total" -eq 0 ]; then
      echo "All transfer packet commitments are cleared."
      return 0
    fi

    if [ "$attempt" -eq 1 ] || [ $((attempt % SETTLEMENT_PROGRESS_EVERY_N_POLLS)) -eq 0 ]; then
      echo "Settlement status (${elapsed}s): pending commitments cardano->entrypoint=${pending_cardano_entrypoint}, entrypoint->injective=${pending_entrypoint_injective}, injective->entrypoint=${pending_injective_entrypoint}, entrypoint->cardano=${pending_entrypoint_cardano}, total=${pending_total}"
    fi

    if [ $((attempt % 3)) -eq 0 ]; then
      echo "Attempting packet-clear pass..."
      if [ "$pending_cardano_entrypoint" -gt 0 ]; then
        clear_packets_since_baseline "$CARDANO_CHAIN_ID" "$cardano_entrypoint_channel_id" "$baseline_cardano_entrypoint_seq"
      fi
      if [ "$pending_entrypoint_injective" -gt 0 ]; then
        clear_packets_since_baseline "$ENTRYPOINT_CHAIN_ID" "$entrypoint_injective_channel_id" "$baseline_entrypoint_injective_seq"
      fi
      if [ "$pending_injective_entrypoint" -gt 0 ]; then
        clear_packets_since_baseline "$INJECTIVE_CHAIN_ID" "$injective_entrypoint_channel_id" "$baseline_injective_entrypoint_seq"
      fi
      if [ "$pending_entrypoint_cardano" -gt 0 ]; then
        clear_packets_since_baseline "$ENTRYPOINT_CHAIN_ID" "$entrypoint_cardano_channel_id" "$baseline_entrypoint_cardano_seq"
      fi
    fi

    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out after ${timeout_seconds}s waiting for Injective token swap settlement."
      return 1
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
SENT_DENOM="$(get_mock_token_denom "$HANDLER_JSON" || true)"
check_string_empty "$SENT_DENOM" "Could not resolve mock token denom from handler.json. Please ensure it exists."

cardano_entrypoint_channel_id="$(get_latest_transfer_channel_id "$CARDANO_CHAIN_ID" "$ENTRYPOINT_CHAIN_ID" || true)"
check_string_empty "$cardano_entrypoint_channel_id" "Cardano->Entrypoint channel not found."
echo "Cardano->Entrypoint channel id: $cardano_entrypoint_channel_id"

entrypoint_cardano_channel_id="$(get_latest_transfer_channel_id "$ENTRYPOINT_CHAIN_ID" "$CARDANO_CHAIN_ID" || true)"
check_string_empty "$entrypoint_cardano_channel_id" "Entrypoint->Cardano channel not found."
echo "Entrypoint->Cardano channel id: $entrypoint_cardano_channel_id"

entrypoint_injective_channel_id="$(get_latest_transfer_channel_id "$ENTRYPOINT_CHAIN_ID" "$INJECTIVE_CHAIN_ID" || true)"
check_string_empty "$entrypoint_injective_channel_id" "Entrypoint->Injective channel not found."
echo "Entrypoint->Injective channel id: $entrypoint_injective_channel_id"

injective_entrypoint_channel_id="$(get_latest_transfer_channel_id "$INJECTIVE_CHAIN_ID" "$ENTRYPOINT_CHAIN_ID" || true)"
check_string_empty "$injective_entrypoint_channel_id" "Injective->Entrypoint channel not found."
echo "Injective->Entrypoint channel id: $injective_entrypoint_channel_id"

baseline_cardano_entrypoint_seq="$(current_max_commitment_seq "$CARDANO_CHAIN_ID" "$cardano_entrypoint_channel_id" || true)"
if [ -z "$baseline_cardano_entrypoint_seq" ]; then
  baseline_cardano_entrypoint_seq=0
fi
baseline_entrypoint_injective_seq="$(current_max_commitment_seq "$ENTRYPOINT_CHAIN_ID" "$entrypoint_injective_channel_id" || true)"
if [ -z "$baseline_entrypoint_injective_seq" ]; then
  baseline_entrypoint_injective_seq=0
fi
baseline_injective_entrypoint_seq="$(current_max_commitment_seq "$INJECTIVE_CHAIN_ID" "$injective_entrypoint_channel_id" || true)"
if [ -z "$baseline_injective_entrypoint_seq" ]; then
  baseline_injective_entrypoint_seq=0
fi
baseline_entrypoint_cardano_seq="$(current_max_commitment_seq "$ENTRYPOINT_CHAIN_ID" "$entrypoint_cardano_channel_id" || true)"
if [ -z "$baseline_entrypoint_cardano_seq" ]; then
  baseline_entrypoint_cardano_seq=0
fi

INJECTIVE_RECEIVER="$(
  docker compose -f "$INJECTIVE_COMPOSE_FILE" exec -T injectived \
    injectived keys show "$INJECTIVE_LOCAL_VALIDATOR_KEY" -a --keyring-backend test --home /root/.injectived 2>/dev/null |
    tr -d '\r' | tail -n 1
)" || true
check_string_empty "$INJECTIVE_RECEIVER" "Unable to resolve Injective validator address from local container."
echo "Injective receiver address: $INJECTIVE_RECEIVER"

forward_to_injective_memo="$(
  jq -nc \
    --arg receiver "$INJECTIVE_RECEIVER" \
    --arg channel "$entrypoint_injective_channel_id" \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)"

echo "Submitting Cardano->Entrypoint->Injective transfer..."
if run_with_timeout "$TRANSFER_SUBMIT_TIMEOUT_SECS" "Cardano->Entrypoint->Injective transfer submit" \
  "$HERMES_BIN" tx ft-transfer \
  --src-chain "$CARDANO_CHAIN_ID" \
  --dst-chain "$ENTRYPOINT_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$cardano_entrypoint_channel_id" \
  --amount "$SENT_AMOUNT_NUM" \
  --denom "$SENT_DENOM" \
  --receiver "$ENTRYPOINT_RECEIVER" \
  --timeout-seconds 3600 \
  --memo "$forward_to_injective_memo"; then
  :
else
  transfer_status=$?
  echo "Cardano->Entrypoint->Injective transfer submit failed (exit ${transfer_status})."
  exit "$transfer_status"
fi

forward_to_cardano_memo="$(
  jq -nc \
    --arg receiver "$CARDANO_RECEIVER" \
    --arg channel "$entrypoint_cardano_channel_id" \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)"

echo "Submitting Injective->Entrypoint->Cardano return leg..."
if run_with_timeout "$TRANSFER_SUBMIT_TIMEOUT_SECS" "Injective->Entrypoint->Cardano transfer submit" \
  "$HERMES_BIN" tx ft-transfer \
  --src-chain "$INJECTIVE_CHAIN_ID" \
  --dst-chain "$ENTRYPOINT_CHAIN_ID" \
  --src-port transfer \
  --src-channel "$injective_entrypoint_channel_id" \
  --amount "$INJECTIVE_RETURN_AMOUNT" \
  --denom "inj" \
  --receiver "$ENTRYPOINT_RECEIVER" \
  --timeout-seconds 3600 \
  --memo "$forward_to_cardano_memo"; then
  :
else
  transfer_status=$?
  echo "Injective->Entrypoint->Cardano transfer submit failed (exit ${transfer_status})."
  exit "$transfer_status"
fi

echo "Waiting for transfer settlement..."
wait_for_settlement 600 10
echo "Injective token swap flow done."
