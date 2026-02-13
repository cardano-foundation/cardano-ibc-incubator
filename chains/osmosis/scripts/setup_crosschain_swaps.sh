#==================================Define util funcions=======================================
check_string_empty() {
  [ -z "$1" ] && echo "$2" && exit 1
}

script_dir=$(dirname "$(realpath "$0")")
repo_root=$(realpath "$script_dir/../../..")
HERMES_BIN="$repo_root/relayer/target/release/hermes"

if [ ! -x "$HERMES_BIN" ]; then
  echo "Local Hermes binary not found at $HERMES_BIN."
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes"
  exit 1
fi

# Function to resolve the latest transfer channel id between two Hermes chains
get_latest_transfer_channel_id() {
  _channel_chain="$1"
  _counterparty_chain="$2"

  _channel_id=$(
    "$HERMES_BIN" --json query channels --chain "$_channel_chain" --counterparty-chain "$_counterparty_chain" 2>/dev/null |
      jq -r '
        select(.result) |
        (if (.result | type) == "array" then .result[-1] else .result end) |
        .channel_id // .channel_a // empty
      ' 2>/dev/null | tail -n 1
  )

  if [ -z "$_channel_id" ]; then
    _channel_id=$(
      "$HERMES_BIN" query channels --chain "$_channel_chain" --counterparty-chain "$_counterparty_chain" 2>/dev/null |
        tr '[:space:]' '\n' |
        grep '^channel-' |
        head -n 1
    )
  fi

  echo "$_channel_id"
}

# Function to extract and print txhash from piped input
log_tx() {
  _log_tx_txhash=$(sed -n 's/^\(txhash: .*\)/\1/p')
  echo "$_log_tx_txhash"
}

print_transfer_diagnostics() {
  echo "=== Diagnostics: packet pending on Cardano->Entrypoint channel ==="
  "$HERMES_BIN" query packet pending --chain "$HERMES_CARDANO_NAME" --port transfer --channel "$cardano_sidechain_chann_id" || true

  echo "=== Diagnostics: packet pending on Entrypoint->Osmosis channel ==="
  "$HERMES_BIN" query packet pending --chain "$HERMES_SIDECHAIN_NAME" --port transfer --channel "$sidechain_osmosis_chann_id" || true
}

wait_for_osmosis_ibc_denom() {
  _receiver="$1"
  _timeout_seconds="${2:-600}"
  _poll_interval="${3:-10}"
  _start_epoch=$(date +%s)
  _attempt=1

  while true; do
    _denom=$(osmosisd query bank balances "$_receiver" $QUERY_FLAGS | jq -r '.balances[]? | select(.denom | startswith("ibc/")) | .denom' | head -n 1)
    if [ -n "$_denom" ] && [ "$_denom" != "null" ]; then
      echo "$_denom"
      return 0
    fi

    _elapsed=$(( $(date +%s) - _start_epoch ))
    if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
      echo "Timed out after ${_timeout_seconds}s while waiting for IBC voucher on Osmosis receiver ${_receiver}."
      print_transfer_diagnostics
      return 1
    fi

    if [ $(( _attempt % 6 )) -eq 0 ]; then
      echo "Still waiting for IBC voucher on Osmosis (${_elapsed}s elapsed)..."
      print_transfer_diagnostics
    fi

    sleep "$_poll_interval"
    _attempt=$(( _attempt + 1 ))
  done
}
#==================================Check required tools=====================================
if ! command -v osmosisd >/dev/null 2>&1; then
  echo "osmosisd not found. Exiting..."
  exit 1
fi

#==================================Setup deployer key=======================================
echo "quality vacuum heart guard buzz spike sight swarm shove special gym robust assume sudden deposit grid alcohol choice devote leader tilt noodle tide penalty" |
  osmosisd --keyring-backend test keys add deployer --recover || echo "Deployer key already existed"

deployer=$(osmosisd keys show deployer --address --keyring-backend test)
check_string_empty "$deployer" "deployer address not found. Exiting..."
echo "deployer address $deployer"

#==================================Setup Hermes=======================================
HERMES_CARDANO_NAME="cardano-devnet"
HERMES_SIDECHAIN_NAME="sidechain"
HERMES_OSMOSIS_NAME="localosmosis"
SENT_AMOUNT="12345678-465209195f27c99dfefdcb725e939ad3262339a9b150992b66673be86d6f636b"
SIDECHAIN_RECEIVER="pfm"
QUERY_FLAGS="--node http://localhost:26658 --output json"

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
denom=$(wait_for_osmosis_ibc_denom "$deployer" 600 10) || exit 1
check_string_empty "$denom" "IBC token on Osmosis not found after waiting. Exiting..."
echo "Sent IBC Denom: $denom"

#==================================Create Osmosis swap pool=======================================

TX_FLAGS="--node http://localhost:26658 --keyring-backend test --from deployer --chain-id localosmosis --gas-prices 0.1uosmo --gas auto --gas-adjustment 1.3 --yes"

# Create the sample_pool.json file
jq -n --arg denom "$denom" '{
  weights: "1\($denom),1uosmo",
  "initial-deposit": "1000000\($denom),1000000uosmo",
  "swap-fee": "0.01",
  "exit-fee": "0.01",
  "future-governor": "168h"
}' >sample_pool.json

# Create pool
osmosisd tx gamm create-pool --pool-file sample_pool.json $TX_FLAGS | log_tx || exit 1
sleep 6
pool_id=$(osmosisd query gamm pools $QUERY_FLAGS | jq -r '.pools[-1].id')
check_string_empty "$pool_id" "Pool ID on Osmosis not found. Exiting..."
echo "Created Pool ID: $pool_id"

#==================================Setup swaprouter contract=======================================
# Store the swaprouter contract
osmosisd tx wasm store $script_dir/../osmosis/cosmwasm/wasm/swaprouter.wasm $TX_FLAGS | log_tx || exit 1
sleep 6
swaprouter_code_id=$(osmosisd query wasm list-code $QUERY_FLAGS | jq -r '.code_infos[-1].code_id')
check_string_empty "$swaprouter_code_id" "swaprouter code id on Osmosis not found. Exiting..."
echo "swaprouter code id: $swaprouter_code_id"

# Instantiate the swaprouter contract
init_swap_router_msg=$(jq -n --arg owner "$deployer" '{owner: $owner}')
osmosisd tx wasm instantiate "$swaprouter_code_id" "$init_swap_router_msg" --admin "$deployer" --label swaprouter $TX_FLAGS | log_tx || exit 1
sleep 6
swaprouter_address=$(osmosisd query wasm list-contract-by-code "$swaprouter_code_id" $QUERY_FLAGS | jq -r '.contracts | [last][0]')
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
osmosisd tx wasm execute "$swaprouter_address" "$set_route_msg" $TX_FLAGS | log_tx || exit 1
sleep 6
echo "swaprouter set_route executed!"

#==================================Setup crosschain_swaps contract=======================================
osmosisd tx wasm store $script_dir/../osmosis/cosmwasm/wasm/crosschain_swaps.wasm $TX_FLAGS | log_tx || exit 1
sleep 6
crosschain_swaps_code_id=$(osmosisd query wasm list-code $QUERY_FLAGS | jq -r '.code_infos[-1].code_id')
check_string_empty "$crosschain_swaps_code_id" "crosschain_swaps code id on Osmosis not found. Exiting..."
echo "crosschain_swaps code id: $crosschain_swaps_code_id"

osmosis_sidechain_chann_id=$("$HERMES_BIN" --json query channels --chain "$HERMES_OSMOSIS_NAME" --counterparty-chain "$HERMES_SIDECHAIN_NAME" | jq -r 'select(.result) | .result[-1].channel_id')
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
osmosisd tx wasm instantiate "$crosschain_swaps_code_id" "$init_crosschain_swaps_msg" --label "crosschain_swaps" --admin "$deployer" $TX_FLAGS | log_tx || exit 1
sleep 6
crosschain_swaps_address=$(osmosisd query wasm list-contract-by-code "$crosschain_swaps_code_id" $QUERY_FLAGS | jq -r '.contracts[-1]')
check_string_empty "$crosschain_swaps_address" "crosschain_swaps address on Osmosis not found. Exiting..."
echo "crosschain_swaps address: $crosschain_swaps_address"
