#!/usr/bin/env bash
set -Eeuo pipefail

check_string_empty() {
  if [ -z "$1" ]; then
    echo "$2"
    exit 1
  fi
}

script_dir=$(dirname "$(realpath "$0")")
repo_root="${CARIBIC_PROJECT_ROOT:-}"
if [ -z "$repo_root" ]; then
  repo_root=$(
    if git -C "$script_dir" rev-parse --show-toplevel >/dev/null 2>&1; then
      git -C "$script_dir" rev-parse --show-toplevel
    else
      realpath "$script_dir/../../../.."
    fi
  )
fi

HERMES_BIN="$repo_root/relayer/target/release/hermes"
OSMOSISD_BIN="${OSMOSISD_BIN:-$(command -v osmosisd || true)}"
if [ -z "$OSMOSISD_BIN" ] && [ -x "$HOME/go/bin/osmosisd" ]; then
  OSMOSISD_BIN="$HOME/go/bin/osmosisd"
fi

[ -x "$HERMES_BIN" ] || {
  echo "Local Hermes binary not found at $HERMES_BIN."
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes"
  exit 1
}
[ -n "$OSMOSISD_BIN" ] && [ -x "$OSMOSISD_BIN" ] || {
  echo "osmosisd not found. Exiting..."
  exit 1
}

log_tx() {
  local raw_output
  raw_output="$(cat)"
  local txhash
  txhash=$(printf '%s\n' "$raw_output" | sed -n 's/^\(txhash: .*\)/\1/p')
  if [ -z "$txhash" ]; then
    txhash=$(printf '%s\n' "$raw_output" | jq -r '.txhash // empty' 2>/dev/null | head -n 1)
    [ -n "$txhash" ] && txhash="txhash: $txhash"
  fi
  if [ -z "$txhash" ]; then
    printf '%s\n' "$raw_output" >&2
    return 1
  fi
  echo "$txhash"
}

get_mock_token_denom() {
  local handler_file="$1"
  [ -f "$handler_file" ] || return 1
  jq -r '.tokens.mock // empty' "$handler_file" 2>/dev/null | head -n 1
}

osmosis_query_json() {
  "$OSMOSISD_BIN" query "$@" --node "$OSMOSIS_NODE" --output json 2>&1
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  "$@" >/dev/null 2>&1 &
  local cmd_pid=$!
  (
    sleep "$timeout_seconds"
    kill "$cmd_pid" >/dev/null 2>&1 || true
  ) >/dev/null 2>&1 &
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
$(printf '%s\n' "$out" | grep -Eo '[0-9]+\.\.=[0-9]+' || true)
EOF
  echo "$max_seq"
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
  local timeout_seconds="${1:-600}"
  local poll_interval="${2:-10}"
  local start_epoch
  start_epoch=$(date +%s)
  local attempt=1

  while true; do
    local cardano_current osmosis_current
    cardano_current="$(current_max_commitment_seq "$HERMES_CARDANO_NAME" "$CARDANO_OSMOSIS_CHANNEL_ID" || true)"
    osmosis_current="$(current_max_commitment_seq "$HERMES_OSMOSIS_NAME" "$OSMOSIS_CARDANO_CHANNEL_ID" || true)"
    [ -n "$cardano_current" ] || cardano_current=0
    [ -n "$osmosis_current" ] || osmosis_current=0

    if [ "$cardano_current" -le "$BASELINE_CARDANO_OSMOSIS_SEQ" ] && [ "$osmosis_current" -le "$BASELINE_OSMOSIS_CARDANO_SEQ" ]; then
      echo "All direct transfer packet commitments are cleared."
      return 0
    fi

    if [ $((attempt % 3)) -eq 0 ]; then
      clear_packets_since_baseline "$HERMES_CARDANO_NAME" "$CARDANO_OSMOSIS_CHANNEL_ID" "$BASELINE_CARDANO_OSMOSIS_SEQ"
      clear_packets_since_baseline "$HERMES_OSMOSIS_NAME" "$OSMOSIS_CARDANO_CHANNEL_ID" "$BASELINE_OSMOSIS_CARDANO_SEQ"
    fi

    local elapsed=$(( $(date +%s) - start_epoch ))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out after ${timeout_seconds}s waiting for direct swap settlement."
      "$HERMES_BIN" query packet pending --chain "$HERMES_CARDANO_NAME" --port transfer --channel "$CARDANO_OSMOSIS_CHANNEL_ID" || true
      "$HERMES_BIN" query packet pending --chain "$HERMES_OSMOSIS_NAME" --port transfer --channel "$OSMOSIS_CARDANO_CHANNEL_ID" || true
      return 1
    fi

    sleep "$poll_interval"
    attempt=$((attempt + 1))
  done
}

wait_for_osmosis_ibc_denom() {
  local receiver="$1"
  local timeout_seconds="${2:-600}"
  local poll_interval="${3:-10}"
  local start_epoch
  start_epoch=$(date +%s)

  while true; do
    local denom
    denom=$(
      osmosis_query_json bank balances "$receiver" |
        jq -r '.balances[]? | select(.denom | startswith("ibc/")) | .denom' |
        head -n 1
    )
    if [ -n "$denom" ] && [ "$denom" != "null" ]; then
      echo "$denom"
      return 0
    fi

    local elapsed=$(( $(date +%s) - start_epoch ))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      echo "Timed out waiting for IBC voucher on Osmosis receiver ${receiver}." >&2
      return 1
    fi
    sleep "$poll_interval"
  done
}

wait_for_wasm_code_id() {
  local timeout_seconds="${1:-180}"
  local poll_interval="${2:-4}"
  local start_epoch
  start_epoch=$(date +%s)
  while true; do
    local code_id
    code_id=$(osmosis_query_json wasm list-code | jq -r '.code_infos[-1].code_id // empty' | head -n 1)
    if [ -n "$code_id" ] && [ "$code_id" != "null" ]; then
      echo "$code_id"
      return 0
    fi
    [ $(( $(date +%s) - start_epoch )) -ge "$timeout_seconds" ] && return 1
    sleep "$poll_interval"
  done
}

wait_for_contract_address() {
  local code_id="$1"
  local timeout_seconds="${2:-180}"
  local poll_interval="${3:-4}"
  local start_epoch
  start_epoch=$(date +%s)
  while true; do
    local address
    address=$(osmosis_query_json wasm list-contract-by-code "$code_id" | jq -r '.contracts | [last][0] // empty')
    if [ -n "$address" ] && [ "$address" != "null" ]; then
      echo "$address"
      return 0
    fi
    [ $(( $(date +%s) - start_epoch )) -ge "$timeout_seconds" ] && return 1
    sleep "$poll_interval"
  done
}

wait_for_latest_pool_id() {
  local timeout_seconds="${1:-120}"
  local poll_interval="${2:-2}"
  local start_epoch
  start_epoch=$(date +%s)
  while true; do
    local pool_id
    pool_id=$(osmosis_query_json gamm pools | jq -r '.pools[-1].id // empty' | head -n 1)
    if [ -n "$pool_id" ] && [ "$pool_id" != "null" ]; then
      echo "$pool_id"
      return 0
    fi
    [ $(( $(date +%s) - start_epoch )) -ge "$timeout_seconds" ] && return 1
    sleep "$poll_interval"
  done
}

DEFAULT_LOCAL_OSMOSIS_DEPLOYER_MNEMONIC="quality vacuum heart guard buzz spike sight swarm shove special gym robust assume sudden deposit grid alcohol choice devote leader tilt noodle tide penalty"
OSMOSIS_DEPLOYER_KEY_NAME="${OSMOSIS_DEPLOYER_KEY_NAME:-deployer}"
OSMOSIS_DEPLOYER_MNEMONIC="${OSMOSIS_DEPLOYER_MNEMONIC:-}"
OSMOSIS_CHAIN_ID="${OSMOSIS_CHAIN_ID:-localosmosis}"
if [ -z "$OSMOSIS_DEPLOYER_MNEMONIC" ] && [ "$OSMOSIS_CHAIN_ID" = "localosmosis" ]; then
  OSMOSIS_DEPLOYER_MNEMONIC="$DEFAULT_LOCAL_OSMOSIS_DEPLOYER_MNEMONIC"
fi
check_string_empty "$OSMOSIS_DEPLOYER_MNEMONIC" "OSMOSIS_DEPLOYER_MNEMONIC is required."

printf '%s\n' "$OSMOSIS_DEPLOYER_MNEMONIC" |
  "$OSMOSISD_BIN" --keyring-backend test keys add "$OSMOSIS_DEPLOYER_KEY_NAME" --recover >/dev/null 2>&1 || true

deployer=$("$OSMOSISD_BIN" keys show "$OSMOSIS_DEPLOYER_KEY_NAME" --address --keyring-backend test)
check_string_empty "$deployer" "deployer address not found. Exiting..."
echo "Osmosis deployer address: $deployer"

HERMES_CARDANO_NAME="${CARDANO_CHAIN_ID:-cardano-devnet}"
HERMES_OSMOSIS_NAME="${HERMES_OSMOSIS_NAME:-localosmosis}"
CARDANO_OSMOSIS_CHANNEL_ID="${CARDANO_OSMOSIS_CHANNEL_ID:-}"
OSMOSIS_CARDANO_CHANNEL_ID="${OSMOSIS_CARDANO_CHANNEL_ID:-}"
CARDANO_RECEIVER="${CARDANO_RECEIVER:-247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8}"
OSMOSIS_NODE="${OSMOSIS_NODE:-http://localhost:26658}"
OSMOSIS_GAS_PRICES="${OSMOSIS_GAS_PRICES:-0.1uosmo}"
SENT_AMOUNT_NUM="${CARIBIC_TOKEN_SWAP_AMOUNT:-12345}"
POOL_BOOTSTRAP_DENOM_AMOUNT_NUM="${OSMOSIS_POOL_BOOTSTRAP_DENOM_AMOUNT:-1000000}"
POOL_BOOTSTRAP_UOSMO_AMOUNT_NUM="${OSMOSIS_POOL_BOOTSTRAP_UOSMO_AMOUNT:-1000000}"
HANDLER_JSON="${HANDLER_JSON:-$repo_root/cardano/offchain/deployments/handler.json}"
SENT_DENOM="$(get_mock_token_denom "$HANDLER_JSON" || true)"
SWAPROUTER_WASM="$repo_root/chains/osmosis/configuration/cosmwasm/wasm/swaprouter.wasm"
CROSSCHAIN_SWAPS_WASM="$repo_root/chains/osmosis/configuration/cosmwasm/wasm/crosschain_swaps.wasm"

check_string_empty "$CARDANO_OSMOSIS_CHANNEL_ID" "CARDANO_OSMOSIS_CHANNEL_ID is required."
check_string_empty "$OSMOSIS_CARDANO_CHANNEL_ID" "OSMOSIS_CARDANO_CHANNEL_ID is required."
check_string_empty "$SENT_DENOM" "Could not resolve mock token denom from handler.json."
[ -f "$SWAPROUTER_WASM" ] || { echo "swaprouter wasm not found at $SWAPROUTER_WASM."; exit 1; }
[ -f "$CROSSCHAIN_SWAPS_WASM" ] || { echo "crosschain_swaps wasm not found at $CROSSCHAIN_SWAPS_WASM."; exit 1; }

BASELINE_CARDANO_OSMOSIS_SEQ="$(current_max_commitment_seq "$HERMES_CARDANO_NAME" "$CARDANO_OSMOSIS_CHANNEL_ID" || true)"
BASELINE_OSMOSIS_CARDANO_SEQ="$(current_max_commitment_seq "$HERMES_OSMOSIS_NAME" "$OSMOSIS_CARDANO_CHANNEL_ID" || true)"
[ -n "$BASELINE_CARDANO_OSMOSIS_SEQ" ] || BASELINE_CARDANO_OSMOSIS_SEQ=0
[ -n "$BASELINE_OSMOSIS_CARDANO_SEQ" ] || BASELINE_OSMOSIS_CARDANO_SEQ=0

echo "Sending Cardano token directly to Osmosis for pool bootstrap..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$HERMES_CARDANO_NAME" \
  --dst-chain "$HERMES_OSMOSIS_NAME" \
  --src-port transfer \
  --src-channel "$CARDANO_OSMOSIS_CHANNEL_ID" \
  --amount "$POOL_BOOTSTRAP_DENOM_AMOUNT_NUM" \
  --denom "$SENT_DENOM" \
  --receiver "$deployer" \
  --timeout-seconds 3600

clear_packets_since_baseline "$HERMES_CARDANO_NAME" "$CARDANO_OSMOSIS_CHANNEL_ID" "$BASELINE_CARDANO_OSMOSIS_SEQ"
denom=$(wait_for_osmosis_ibc_denom "$deployer" 600 10)
check_string_empty "$denom" "IBC token on Osmosis not found after waiting."
echo "Direct Cardano voucher denom on Osmosis: $denom"

TX_FLAGS=(--node "$OSMOSIS_NODE" --keyring-backend test --from "$OSMOSIS_DEPLOYER_KEY_NAME" --chain-id "$OSMOSIS_CHAIN_ID" --gas-prices "$OSMOSIS_GAS_PRICES" --gas auto --gas-adjustment 1.3 --broadcast-mode sync --yes)
sample_pool_file="$(mktemp)"
trap 'rm -f "$sample_pool_file"' EXIT

jq -n --arg denom "$denom" '{
  weights: "1\($denom),1uosmo",
  "initial-deposit": "'"${POOL_BOOTSTRAP_DENOM_AMOUNT_NUM}"'\($denom),'"${POOL_BOOTSTRAP_UOSMO_AMOUNT_NUM}"'uosmo",
  "swap-fee": "0.01",
  "exit-fee": "0.01",
  "future-governor": "168h"
}' >"$sample_pool_file"

"$OSMOSISD_BIN" tx gamm create-pool --pool-file "$sample_pool_file" "${TX_FLAGS[@]}" 2>&1 | log_tx
sleep 3
pool_id=$(wait_for_latest_pool_id 120 2)
check_string_empty "$pool_id" "Pool ID on Osmosis not found."
echo "Created Pool ID: $pool_id"

"$OSMOSISD_BIN" tx wasm store "$SWAPROUTER_WASM" "${TX_FLAGS[@]}" 2>&1 | log_tx
sleep 3
swaprouter_code_id=$(wait_for_wasm_code_id 180 4)
check_string_empty "$swaprouter_code_id" "swaprouter code id on Osmosis not found."
echo "swaprouter code id: $swaprouter_code_id"

init_swap_router_msg=$(jq -n --arg owner "$deployer" '{owner: $owner}')
"$OSMOSISD_BIN" tx wasm instantiate "$swaprouter_code_id" "$init_swap_router_msg" --admin "$deployer" --label swaprouter "${TX_FLAGS[@]}" 2>&1 | log_tx
sleep 3
swaprouter_address=$(wait_for_contract_address "$swaprouter_code_id" 180 4)
check_string_empty "$swaprouter_address" "swaprouter address on Osmosis not found."
echo "swaprouter address: $swaprouter_address"

set_route_msg=$(jq -n --arg denom "$denom" --arg pool_id "$pool_id" '{
  set_route: {
    input_denom: $denom,
    output_denom: "uosmo",
    pool_route: [{pool_id: $pool_id, token_out_denom: "uosmo"}]
  }
}')
"$OSMOSISD_BIN" tx wasm execute "$swaprouter_address" "$set_route_msg" "${TX_FLAGS[@]}" 2>&1 | log_tx
sleep 3
echo "swaprouter set_route executed."

"$OSMOSISD_BIN" tx wasm store "$CROSSCHAIN_SWAPS_WASM" "${TX_FLAGS[@]}" 2>&1 | log_tx
sleep 3
crosschain_swaps_code_id=$(wait_for_wasm_code_id 180 4)
check_string_empty "$crosschain_swaps_code_id" "crosschain_swaps code id on Osmosis not found."
echo "crosschain_swaps code id: $crosschain_swaps_code_id"

init_crosschain_swaps_msg=$(jq -n \
  --arg governor "$deployer" \
  --arg swap_contract "$swaprouter_address" \
  --arg channel_id "$OSMOSIS_CARDANO_CHANNEL_ID" \
  '{governor: $governor, swap_contract: $swap_contract, channels: [["cardano", $channel_id]]}')
"$OSMOSISD_BIN" tx wasm instantiate "$crosschain_swaps_code_id" "$init_crosschain_swaps_msg" --label "crosschain_swaps" --admin "$deployer" "${TX_FLAGS[@]}" 2>&1 | log_tx
sleep 3
crosschain_swaps_address=$(wait_for_contract_address "$crosschain_swaps_code_id" 180 4)
check_string_empty "$crosschain_swaps_address" "crosschain_swaps address on Osmosis not found."
echo "crosschain_swaps address: $crosschain_swaps_address"

direct_cardano_receiver="ibc:${OSMOSIS_CARDANO_CHANNEL_ID}/${CARDANO_RECEIVER}"
swap_memo=$(jq -nc \
  --arg contract "$crosschain_swaps_address" \
  --arg receiver "$direct_cardano_receiver" \
  '{wasm: {contract: $contract, msg: {osmosis_swap: {output_denom: "uosmo", slippage: {min_output_amount: "1"}, receiver: $receiver, on_failed_delivery: "do_nothing", next_memo: {}}}}}')

BASELINE_CARDANO_OSMOSIS_SEQ="$(current_max_commitment_seq "$HERMES_CARDANO_NAME" "$CARDANO_OSMOSIS_CHANNEL_ID" || true)"
BASELINE_OSMOSIS_CARDANO_SEQ="$(current_max_commitment_seq "$HERMES_OSMOSIS_NAME" "$OSMOSIS_CARDANO_CHANNEL_ID" || true)"
[ -n "$BASELINE_CARDANO_OSMOSIS_SEQ" ] || BASELINE_CARDANO_OSMOSIS_SEQ=0
[ -n "$BASELINE_OSMOSIS_CARDANO_SEQ" ] || BASELINE_OSMOSIS_CARDANO_SEQ=0

echo "Submitting direct Cardano->Osmosis crosschain swap..."
"$HERMES_BIN" tx ft-transfer \
  --src-chain "$HERMES_CARDANO_NAME" \
  --dst-chain "$HERMES_OSMOSIS_NAME" \
  --src-port transfer \
  --src-channel "$CARDANO_OSMOSIS_CHANNEL_ID" \
  --amount "$SENT_AMOUNT_NUM" \
  --denom "$SENT_DENOM" \
  --receiver "$crosschain_swaps_address" \
  --timeout-seconds 3600 \
  --memo "$swap_memo"

clear_packets_since_baseline "$HERMES_CARDANO_NAME" "$CARDANO_OSMOSIS_CHANNEL_ID" "$BASELINE_CARDANO_OSMOSIS_SEQ"
wait_for_commitments_cleared 900 10
echo "Direct Cardano-to-Osmosis token swap completed."
