#!/usr/bin/env bash
set -o pipefail

#==================================Define util funcions=======================================
check_string_empty() {
  [ -z "$1" ] && echo "$2" && exit 1
}

script_dir=$(dirname "$(realpath "$0")")
repo_root=$(
  if git -C "$script_dir" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$script_dir" rev-parse --show-toplevel
  else
    realpath "$script_dir/../../../.."
  fi
)
HERMES_BIN="$repo_root/relayer/target/release/hermes"
OSMOSISD_BIN="${OSMOSISD_BIN:-$(command -v osmosisd || true)}"
if [ -z "$OSMOSISD_BIN" ] && [ -x "$HOME/go/bin/osmosisd" ]; then
  OSMOSISD_BIN="$HOME/go/bin/osmosisd"
fi

if [ ! -x "$HERMES_BIN" ]; then
  echo "Local Hermes binary not found at $HERMES_BIN."
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes"
  exit 1
fi

# Returns the counterparty channel id for one transfer channel end.
extract_channel_end_json_field() {
  _chain="$1"
  _channel="$2"
  _jq_expression="$3"

  "$HERMES_BIN" --json query channel end --chain "$_chain" --port transfer --channel "$_channel" 2>/dev/null |
    jq -r "select(.result) | ${_jq_expression} // empty" 2>/dev/null |
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

# Resolve a transfer channel id that has a valid, symmetric counterparty channel end.
get_latest_transfer_channel_id() {
  _channel_chain="$1"
  _counterparty_chain="$2"

  _channel_candidates=$(
    "$HERMES_BIN" --json query channels --chain "$_channel_chain" --counterparty-chain "$_counterparty_chain" 2>/dev/null |
      jq -r '
        select(.result) |
        (if (.result | type) == "array" then .result[] else .result end) |
        .channel_id // .channel_a // empty
      ' 2>/dev/null |
      sort -t- -k2,2nr
  )

  while IFS= read -r _candidate_channel_id; do
    [ -z "$_candidate_channel_id" ] && continue
    # Token-swap transfers require a fully open channel end.
    # We intentionally skip stale ids in Init or TryOpen state.
    _candidate_state=$(extract_channel_end_state "$_channel_chain" "$_candidate_channel_id")
    if ! is_open_channel_state "$_candidate_state"; then
      continue
    fi
    _counterparty_channel_id=$(extract_counterparty_channel_id "$_channel_chain" "$_candidate_channel_id")
    [ -z "$_counterparty_channel_id" ] && continue
    # Both ends must be open before we treat this channel pair as usable.
    _counterparty_state=$(extract_channel_end_state "$_counterparty_chain" "$_counterparty_channel_id")
    if ! is_open_channel_state "$_counterparty_state"; then
      continue
    fi
    _reverse_counterparty_channel_id=$(extract_counterparty_channel_id "$_counterparty_chain" "$_counterparty_channel_id")
    if [ "$_reverse_counterparty_channel_id" = "$_candidate_channel_id" ]; then
      echo "$_candidate_channel_id"
      return 0
    fi
  done <<EOF
$_channel_candidates
EOF
  # Return empty when no open symmetric channel exists.
  # Callers handle this as a hard prerequisite failure.
  echo ""
}

# Function to extract and print txhash from piped input
log_tx() {
  _raw_output="$(cat)"
  _log_tx_txhash=$(printf '%s\n' "$_raw_output" | sed -n 's/^\(txhash: .*\)/\1/p')
  if [ -z "$_log_tx_txhash" ]; then
    _log_tx_txhash=$(printf '%s\n' "$_raw_output" | jq -r '.txhash // empty' 2>/dev/null | head -n 1)
    if [ -n "$_log_tx_txhash" ]; then
      _log_tx_txhash="txhash: $_log_tx_txhash"
    fi
  fi
  if [ -z "$_log_tx_txhash" ]; then
    printf '%s\n' "$_raw_output" >&2
    return 1
  fi
  echo "$_log_tx_txhash"
}

osmosis_query_json() {
  "$OSMOSISD_BIN" query "$@" --node "$OSMOSIS_NODE" --output json 2>&1
}

wait_for_wasm_code_id() {
  _timeout_seconds="${1:-120}"
  _poll_interval="${2:-2}"
  _start_epoch=$(date +%s)
  _latest_code_id=""

  while true; do
    _latest_code_id=$(
      osmosis_query_json wasm list-code |
      jq -r '.code_infos[-1].code_id // empty' |
      head -n 1
    )
    if [ -n "$_latest_code_id" ] && [ "$_latest_code_id" != "null" ]; then
      echo "$_latest_code_id"
      return 0
    fi

    _elapsed=$(( $(date +%s) - _start_epoch ))
    if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
      echo ""
      return 1
    fi

    sleep "$_poll_interval"
  done
}

wait_for_latest_pool_id() {
  _timeout_seconds="${1:-120}"
  _poll_interval="${2:-2}"
  _start_epoch=$(date +%s)
  _latest_pool_id=""

  while true; do
    _latest_pool_id=$(
      osmosis_query_json gamm pools |
      jq -r '.pools[-1].id // empty' |
      head -n 1
    )
    if [ -n "$_latest_pool_id" ] && [ "$_latest_pool_id" != "null" ]; then
      echo "$_latest_pool_id"
      return 0
    fi

    _elapsed=$(( $(date +%s) - _start_epoch ))
    if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
      echo ""
      return 1
    fi

    sleep "$_poll_interval"
  done
}

wait_for_contract_address() {
  _code_id="$1"
  _timeout_seconds="${2:-120}"
  _poll_interval="${3:-2}"
  _start_epoch=$(date +%s)

  if [ -z "$_code_id" ]; then
    echo ""
    return 1
  fi

  while true; do
    _latest_contract_address=$(
      osmosis_query_json wasm list-contract-by-code "$_code_id" |
      jq -r '.contracts | [last][0] // empty'
    )
    if [ -n "$_latest_contract_address" ] && [ "$_latest_contract_address" != "null" ]; then
      echo "$_latest_contract_address"
      return 0
    fi

    _elapsed=$(( $(date +%s) - _start_epoch ))
    if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
      echo ""
      return 1
    fi

    sleep "$_poll_interval"
  done
}

wait_for_crosschain_address() {
  _code_id="$1"
  _timeout_seconds="${2:-120}"
  _poll_interval="${3:-2}"
  _start_epoch=$(date +%s)

  if [ -z "$_code_id" ]; then
    echo ""
    return 1
  fi

  while true; do
    _latest_contract_address=$(
      osmosis_query_json wasm list-contract-by-code "$_code_id" |
      jq -r '.contracts | [last] // empty'
    )
    if [ -n "$_latest_contract_address" ] && [ "$_latest_contract_address" != "null" ] && [ "$_latest_contract_address" != "[]" ]; then
      _latest_contract_address=$(echo "$_latest_contract_address" | jq -r '.[0]')
      if [ -n "$_latest_contract_address" ] && [ "$_latest_contract_address" != "null" ]; then
        echo "$_latest_contract_address"
        return 0
      fi
    fi

    _elapsed=$(( $(date +%s) - _start_epoch ))
    if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
      echo ""
      return 1
    fi

    sleep "$_poll_interval"
  done
}

print_transfer_diagnostics() {
  echo "=== Diagnostics: packet pending on Cardano->Entrypoint channel ===" >&2
  "$HERMES_BIN" query packet pending --chain "$HERMES_CARDANO_NAME" --port transfer --channel "$cardano_sidechain_chann_id" || true

  echo "=== Diagnostics: packet pending on Entrypoint->Osmosis channel ===" >&2
  "$HERMES_BIN" query packet pending --chain "$HERMES_SIDECHAIN_NAME" --port transfer --channel "$sidechain_osmosis_chann_id" || true
}

clear_swap_packets() {
  run_with_timeout 120 "$HERMES_BIN" clear packets --chain "$HERMES_CARDANO_NAME" --port transfer --channel "$cardano_sidechain_chann_id"
  run_with_timeout 120 "$HERMES_BIN" clear packets --chain "$HERMES_SIDECHAIN_NAME" --port transfer --channel "$sidechain_osmosis_chann_id"
}

run_with_timeout() {
  local _rwto_seconds="$1"
  shift
  "$@" >/dev/null 2>&1 &
  local _cmd_pid=$!
  (
    sleep "$_rwto_seconds"
    kill "$_cmd_pid" >/dev/null 2>&1 || true
  ) &
  local _watchdog_pid=$!
  wait "$_cmd_pid" >/dev/null 2>&1 || true
  kill "$_watchdog_pid" >/dev/null 2>&1 || true
}

wait_for_osmosis_ibc_denom() {
  _receiver="$1"
  _timeout_seconds="${2:-600}"
  _poll_interval="${3:-10}"
  _clear_packets_enabled="${CARIBIC_CLEAR_SWAP_PACKETS:-false}"
  _start_epoch=$(date +%s)
  _attempt=1

  while true; do
    _denom=$(
      osmosis_query_json bank balances "$_receiver" |
      jq -r '.balances[]? | select(.denom | startswith("ibc/")) | .denom' |
      head -n 1
    )
    if [ -n "$_denom" ] && [ "$_denom" != "null" ]; then
      echo "$_denom"
      return 0
    fi

    _elapsed=$(( $(date +%s) - _start_epoch ))
    if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
      echo "Timed out after ${_timeout_seconds}s while waiting for IBC voucher on Osmosis receiver ${_receiver}." >&2
      if [ "$_clear_packets_enabled" = "true" ]; then
        clear_swap_packets
      fi
      print_transfer_diagnostics
      return 1
    fi

    if [ $(( _attempt % 6 )) -eq 0 ]; then
      if [ "$_clear_packets_enabled" = "true" ]; then
        clear_swap_packets
      fi
      echo "Still waiting for IBC voucher on Osmosis (${_elapsed}s elapsed)..." >&2
      print_transfer_diagnostics
    fi

    sleep "$_poll_interval"
    _attempt=$(( _attempt + 1 ))
  done
}
#==================================Check required tools=====================================
if [ -z "$OSMOSISD_BIN" ] || [ ! -x "$OSMOSISD_BIN" ]; then
  echo "osmosisd not found. Exiting..."
  exit 1
fi

get_mock_token_denom() {
  local _handler_file="$1"

  if [ ! -f "$_handler_file" ]; then
    echo ""
    return 1
  fi

  local _denom
  _denom="$(jq -r '.tokens.mock // empty' "$_handler_file" 2>/dev/null)"
  if [ -n "$_denom" ] && [ "$_denom" != "null" ]; then
    echo "$_denom"
    return 0
  fi

  echo ""
  return 1
}

#==================================Setup deployer key=======================================
echo "quality vacuum heart guard buzz spike sight swarm shove special gym robust assume sudden deposit grid alcohol choice devote leader tilt noodle tide penalty" |
  "$OSMOSISD_BIN" --keyring-backend test keys add deployer --recover || echo "Deployer key already existed"

deployer=$("$OSMOSISD_BIN" keys show deployer --address --keyring-backend test)
check_string_empty "$deployer" "deployer address not found. Exiting..."
echo "deployer address $deployer"

#==================================Setup Hermes=======================================
HERMES_CARDANO_NAME="cardano-devnet"
HERMES_SIDECHAIN_NAME="sidechain"
HERMES_OSMOSIS_NAME="localosmosis"
SENT_AMOUNT_NUM="${CARIBIC_TOKEN_SWAP_AMOUNT:-12345678}"
HANDLER_JSON="$repo_root/cardano/offchain/deployments/handler.json"
SENT_DENOM="$(get_mock_token_denom "$HANDLER_JSON")"
if [ -z "$SENT_DENOM" ]; then
  check_string_empty "" "Could not resolve mock token denom from handler.json. Please ensure the handler deployment file is present and up to date."
fi
SENT_AMOUNT="${SENT_AMOUNT_NUM}-${SENT_DENOM}"
SIDECHAIN_RECEIVER="pfm"
OSMOSIS_NODE="http://localhost:26658"
SWAPROUTER_WASM="$repo_root/chains/osmosis/osmosis/cosmwasm/wasm/swaprouter.wasm"
CROSSCHAIN_SWAPS_WASM="$repo_root/chains/osmosis/osmosis/cosmwasm/wasm/crosschain_swaps.wasm"

# query channels' id
cardano_sidechain_chann_id=$(get_latest_transfer_channel_id "$HERMES_CARDANO_NAME" "$HERMES_SIDECHAIN_NAME")
check_string_empty "$cardano_sidechain_chann_id" "Cardano->Entrypoint chain channel not found. Exiting..."
echo "Cardano->Entrypoint chain channel id: $cardano_sidechain_chann_id"

sidechain_osmosis_chann_id=$(get_latest_transfer_channel_id "$HERMES_SIDECHAIN_NAME" "$HERMES_OSMOSIS_NAME")
check_string_empty "$sidechain_osmosis_chann_id" "Entrypoint chain->Osmosis channel not found. Exiting..."
echo "Entrypoint chain->Osmosis channel id: $sidechain_osmosis_chann_id"

memo=$(
  jq -nc \
    --arg receiver "$deployer" \
    --arg channel "$sidechain_osmosis_chann_id" \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)
echo "Send IBC token memo: $memo"

#==================================Send Cardano token to Osmosis=======================================
sent_amount="${SENT_AMOUNT%%-*}"
sent_denom="${SENT_AMOUNT#*-}"
check_string_empty "$sent_amount" "Transfer amount not found in SENT_AMOUNT. Exiting..."
check_string_empty "$sent_denom" "Transfer denom not found in SENT_AMOUNT. Exiting..."
[ -f "$SWAPROUTER_WASM" ] || { echo "swaprouter wasm not found at $SWAPROUTER_WASM. Exiting..."; exit 1; }
[ -f "$CROSSCHAIN_SWAPS_WASM" ] || { echo "crosschain_swaps wasm not found at $CROSSCHAIN_SWAPS_WASM. Exiting..."; exit 1; }

"$HERMES_BIN" tx ft-transfer \
  --src-chain "$HERMES_CARDANO_NAME" \
  --dst-chain "$HERMES_SIDECHAIN_NAME" \
  --src-port transfer \
  --src-channel "$cardano_sidechain_chann_id" \
  --amount "$sent_amount" \
  --denom "$sent_denom" \
  --receiver "$SIDECHAIN_RECEIVER" \
  --timeout-seconds 3600 \
  --memo "$memo" ||
  exit 1
echo "Waiting for IBC voucher to arrive on Osmosis..."
if [ "${CARIBIC_CLEAR_SWAP_PACKETS:-false}" = "true" ]; then
  clear_swap_packets
fi
denom=$(wait_for_osmosis_ibc_denom "$deployer" 600 10) || exit 1
check_string_empty "$denom" "IBC token on Osmosis not found after waiting. Exiting..."
echo "Sent IBC Denom: $denom"

#==================================Create Osmosis swap pool=======================================

TX_FLAGS=(--node "$OSMOSIS_NODE" --keyring-backend test --from deployer --chain-id localosmosis --gas-prices 0.1uosmo --gas auto --gas-adjustment 1.3 --broadcast-mode sync --yes)
sample_pool_file="$(mktemp)"
cleanup_sample_pool_file() {
  rm -f "$sample_pool_file"
}
trap cleanup_sample_pool_file EXIT

# Create the sample_pool.json file
jq -n --arg denom "$denom" '{
  weights: "1\($denom),1uosmo",
  "initial-deposit": "1000000\($denom),1000000uosmo",
  "swap-fee": "0.01",
  "exit-fee": "0.01",
  "future-governor": "168h"
}' >"$sample_pool_file"

# Create pool
  "$OSMOSISD_BIN" tx gamm create-pool --pool-file "$sample_pool_file" "${TX_FLAGS[@]}" 2>&1 | log_tx || exit 1
  sleep 3
  pool_id=$(wait_for_latest_pool_id 120 2)
check_string_empty "$pool_id" "Pool ID on Osmosis not found. Exiting..."
echo "Created Pool ID: $pool_id"

#==================================Setup swaprouter contract=======================================
# Store the swaprouter contract
  "$OSMOSISD_BIN" tx wasm store "$SWAPROUTER_WASM" "${TX_FLAGS[@]}" 2>&1 | log_tx || exit 1
  sleep 3
  swaprouter_code_id=$(wait_for_wasm_code_id 180 4)
  check_string_empty "$swaprouter_code_id" "swaprouter code id on Osmosis not found. Exiting..."
  echo "swaprouter code id: $swaprouter_code_id"

# Instantiate the swaprouter contract
init_swap_router_msg=$(jq -n --arg owner "$deployer" '{owner: $owner}')
  "$OSMOSISD_BIN" tx wasm instantiate "$swaprouter_code_id" "$init_swap_router_msg" --admin "$deployer" --label swaprouter "${TX_FLAGS[@]}" 2>&1 | log_tx || exit 1
  sleep 3
  swaprouter_address=$(wait_for_contract_address "$swaprouter_code_id" 180 4)
  check_string_empty "$swaprouter_address" "swaprouter address on Osmosis not found. Exiting..."
  echo "swaprouter address: $swaprouter_address"

# configure the swaprouter
set_route_msg=$(jq -n --arg denom "$denom" --arg pool_id "$pool_id" \
  '{
  set_route: {
    input_denom: $denom,
    output_denom: "uosmo",
    pool_route: [
      {
        pool_id: $pool_id,
        token_out_denom: "uosmo"
      }
    ]
  }
}')
  "$OSMOSISD_BIN" tx wasm execute "$swaprouter_address" "$set_route_msg" "${TX_FLAGS[@]}" 2>&1 | log_tx || exit 1
  sleep 3
  echo "swaprouter set_route executed!"

#==================================Setup crosschain_swaps contract=======================================
  "$OSMOSISD_BIN" tx wasm store "$CROSSCHAIN_SWAPS_WASM" "${TX_FLAGS[@]}" 2>&1 | log_tx || exit 1
  sleep 3
  crosschain_swaps_code_id=$(wait_for_wasm_code_id 180 4)
  check_string_empty "$crosschain_swaps_code_id" "crosschain_swaps code id on Osmosis not found. Exiting..."
  echo "crosschain_swaps code id: $crosschain_swaps_code_id"

osmosis_sidechain_chann_id=$(get_latest_transfer_channel_id "$HERMES_OSMOSIS_NAME" "$HERMES_SIDECHAIN_NAME")
check_string_empty "$osmosis_sidechain_chann_id" "Osmosis->Entrypoint chain channel not found in Open state. Exiting..."
echo "Osmosis->Entrypoint chain channel id: $osmosis_sidechain_chann_id"

# Instantiate crosschain_swaps
init_crosschain_swaps_msg=$(
  jq -n \
    --arg governor "$deployer" \
    --arg swap_contract "$swaprouter_address" \
    --arg channel_id "$osmosis_sidechain_chann_id" \
    '{
    governor: $governor,
    swap_contract: $swap_contract,
    channels: [["cosmos", $channel_id]]
  }'
)
  "$OSMOSISD_BIN" tx wasm instantiate "$crosschain_swaps_code_id" "$init_crosschain_swaps_msg" --label "crosschain_swaps" --admin "$deployer" "${TX_FLAGS[@]}" 2>&1 | log_tx || exit 1
  sleep 3
  crosschain_swaps_address=$(wait_for_crosschain_address "$crosschain_swaps_code_id" 180 4)
  check_string_empty "$crosschain_swaps_address" "crosschain_swaps address on Osmosis not found. Exiting..."
echo "crosschain_swaps address: $crosschain_swaps_address"
