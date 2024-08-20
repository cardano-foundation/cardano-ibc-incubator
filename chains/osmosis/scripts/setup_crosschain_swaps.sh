#==================================Define util funcions=======================================
check_string_empty() {
  [ -z $1 ] && echo "$2" && exit 1
}

# Function to extract and print txhash from piped input
log_tx() {
  _log_tx_txhash=$(sed -n 's/^\(txhash: .*\)/\1/p')
  echo "$_log_tx_txhash"
}
#==================================Check required tools=====================================
osmosisd_location=$(which osmosisd)
check_string_empty "$osmosisd_location" "osmosisd not found. Exiting..."

osmosisd_location=$(which hermes)
check_string_empty "$osmosisd_location" "hermes not found. Exiting..."

#==================================Setup deployer key=======================================
echo "quality vacuum heart guard buzz spike sight swarm shove special gym robust assume sudden deposit grid alcohol choice devote leader tilt noodle tide penalty" |
  osmosisd --keyring-backend test keys add deployer --recover || echo "Deployer key already existed"

deployer=$(osmosisd keys show deployer --address --keyring-backend test)
check_string_empty "$deployer" "deployer address not found. Exiting..."
echo "deployer address $deployer"

#==================================Setup relayer=======================================
RLY_CONTAINER_NAME="relayer"
if ! docker ps --format '{{.Names}}' | grep -q "^$RLY_CONTAINER_NAME$"; then
  echo "Container $RLY_CONTAINER_NAME does not exist. Exiting..."
  exit 1
fi
rly='docker exec -it relayer bin/rly'

RELAYER_PATH="demo"
CARDANO_CHAIN_NAME="ibc-0"
SIDECHAIN_CHAIN_NAME="ibc-1"
SENT_AMOUNT="12345678-9fc33a6ffaa8d1f600c161aa383739d5af37807ed83347cc133521c96d6f636b"
SIDECHAIN_RECEIVER="pfm"
HERMES_OSMOSIS_NAME="localosmosis"
HERMES_SIDECHAIN_NAME="sidechain"

# query channels' id
cardano_sidechain_conn_id=$($rly config show --json | jq -r --arg path "$RELAYER_PATH" '.paths[$path].src."connection-id"')
check_string_empty "$cardano_sidechain_conn_id" "Cardano<->Sidechain connection not found. Exiting..."

cardano_sidechain_chann_id=$($rly query connection-channels "$CARDANO_CHAIN_NAME" "$cardano_sidechain_conn_id" --reverse --limit 1 | jq -r '.channel_id')
check_string_empty "$cardano_sidechain_chann_id" "Cardano->Sidechain channel not found. Exiting..."
echo "Cardano->Sidechain channel id: $cardano_sidechain_chann_id"

sidechain_osmosis_chann_id=$(hermes --json query channels --chain "$HERMES_OSMOSIS_NAME" --counterparty-chain "$HERMES_SIDECHAIN_NAME" --show-counterparty | jq -r 'select(.result) | .result[-1].channel_b')
check_string_empty "$sidechain_osmosis_chann_id" "Sidechain->Osmosis channel not found. Exiting..."
echo "Sidechain->Osmosis channel id: $sidechain_osmosis_chann_id"

memo=$(
  jq -nc \
    --arg receiver "$deployer" \
    --arg channel "$sidechain_osmosis_chann_id" \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)
echo "Send IBC token memo: $memo"

#==================================Send Cardano token to Osmosis=======================================
$rly transact transfer "$CARDANO_CHAIN_NAME" "$SIDECHAIN_CHAIN_NAME" "$SENT_AMOUNT" "$SIDECHAIN_RECEIVER" "$cardano_sidechain_chann_id" \
  --path "$RELAYER_PATH" --timeout-time-offset 1h \
  --memo "$memo" ||
  exit 1
echo "Waiting for transfer tx complete..."
sleep 600

QUERY_FLAGS="--node http://localhost:26658 --output json"

denom=$(osmosisd query bank balances "$deployer" $QUERY_FLAGS | jq -r '.balances[] | select(.denom | contains("ibc")) | .denom')
check_string_empty "$denom" "IBC token on Osmosis not found. Exiting..."
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
script_dir=$(dirname $(realpath $0))

# Store the swaprouter contract
osmosisd tx wasm store $script_dir/../cosmwasm/wasm/swaprouter.wasm $TX_FLAGS | log_tx || exit 1
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
osmosisd tx wasm store $script_dir/../cosmwasm/wasm/crosschain_swaps.wasm $TX_FLAGS | log_tx || exit 1
sleep 6
crosschain_swaps_code_id=$(osmosisd query wasm list-code $QUERY_FLAGS | jq -r '.code_infos[-1].code_id')
check_string_empty "$crosschain_swaps_code_id" "crosschain_swaps code id on Osmosis not found. Exiting..."
echo "crosschain_swaps code id: $crosschain_swaps_code_id"

osmosis_sidechain_chann_id=$(hermes --json query channels --chain "$HERMES_OSMOSIS_NAME" --counterparty-chain "$HERMES_SIDECHAIN_NAME" | jq -r 'select(.result) | .result[-1].channel_id')
echo "Osmosis->Sidechain channel id: $osmosis_sidechain_chann_id"

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
