#==================================Setup deployer key=======================================
echo "quality vacuum heart guard buzz spike sight swarm shove special gym robust assume sudden deposit grid alcohol choice devote leader tilt noodle tide penalty" |
  osmosisd --keyring-backend test keys add deployer --recover || echo "Deployer key already existed"

deployer=$(osmosisd keys show deployer -a)
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
cardano_sidechain_chann_id=$($rly query connection-channels $CARDANO_CHAIN_NAME $cardano_sidechain_conn_id --reverse --limit 1 | jq -r '.channel_id')
echo "Cardano->Sidechain channel id: $cardano_sidechain_chann_id"
sidechain_osmosis_chann_id=$(hermes --json query channels --chain $HERMES_OSMOSIS_NAME --counterparty-chain $HERMES_SIDECHAIN_NAME --show-counterparty | jq -r 'select(.result) | .result[-1].channel_b')
echo "Sidechain->Osmosis channel id: $sidechain_osmosis_chann_id"

memo=$(
  jq -nc \
    --arg receiver $deployer \
    --arg channel $sidechain_osmosis_chann_id \
    '{forward: {receiver: $receiver, port: "transfer", channel: $channel}}'
)
echo $memo

#==================================Send Cardano token to Osmosis=======================================
$rly transact transfer $CARDANO_CHAIN_NAME $SIDECHAIN_CHAIN_NAME $SENT_AMOUNT $SIDECHAIN_RECEIVER $cardano_sidechain_chann_id \
  --path $RELAYER_PATH --timeout-time-offset 1h \
  --memo $memo ||
  exit 1
echo "Waiting for transfer tx complete..."
sleep 30

denom=$(osmosisd query bank balances "$deployer" --output json | jq -r '.balances[] | select(.denom | contains("ibc")) | .denom')
# Check whether deployer has an IBC token
if [ -z "$denom" ]; then
  echo "No IBC token found. Exiting..."
  exit 1
fi
echo "Sent IBC Denom: $denom"

#==================================Create Osmosis swap pool=======================================

TX_FLAGS=(--node http://localhost:26658 --keyring-backend test --chain-id localosmosis --gas-prices 0.1uosmo --gas auto --gas-adjustment 1.3 --yes)

# Create the sample_pool.json file
cat >sample_pool.json <<EOF
{
        "weights": "1${denom},1uosmo",
        "initial-deposit": "1000000${denom},1000000uosmo",
        "swap-fee": "0.01",
        "exit-fee": "0.01",
        "future-governor": "168h"
}
EOF

# Create pool
osmosisd tx gamm create-pool --pool-file sample_pool.json --from deployer "${TX_FLAGS[@]}" || exit 1
sleep 6
pool_id=$(osmosisd query gamm pools -o json | jq -r '.pools[-1].id')
echo "Created Pool ID: $pool_id"

#==================================Setup swaprouter contract=======================================
script_dir=$(dirname $(realpath $0))

# Store the swaprouter contract
osmosisd tx wasm store $script_dir/../cosmwasm/artifacts/swaprouter.wasm --from deployer "${TX_FLAGS[@]}" || exit 1
sleep 6
swaprouter_code_id=$(osmosisd query wasm list-code --output json | jq -r '.code_infos[-1].code_id')
echo "swaprouter code id: $swaprouter_code_id"

# Instantiate the swaprouter contract
init_swap_router_msg=$(jq -n --arg owner "$deployer" '{owner: $owner}')
osmosisd tx wasm instantiate "$swaprouter_code_id" "$init_swap_router_msg" --admin $deployer --label swaprouter --from deployer "${TX_FLAGS[@]}" || exit 1
sleep 6
swaprouter_address=$(osmosisd query wasm list-contract-by-code "$swaprouter_code_id" --output json | jq -r '.contracts | [last][0]')
echo "swaprouter address: $swaprouter_address"

# configure the swaprouter
set_route_msg=$(jq -n --arg denom $denom --arg pool_id $pool_id \
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
osmosisd tx wasm execute "$swaprouter_address" "$set_route_msg" --from deployer "${TX_FLAGS[@]}" || exit 1
sleep 6
echo "swaprouter set_route executed!"

#==================================Setup crosschain_swaps contract=======================================
osmosisd tx wasm store $script_dir/../cosmwasm/artifacts/crosschain_swaps.wasm --from $deployer "${TX_FLAGS[@]}" || exit 1
sleep 6
crosschain_swaps_code_id=$(osmosisd query wasm list-code -o json | jq -r '.code_infos[-1].code_id')
echo "crosschain_swaps code id: $crosschain_swaps_code_id"

osmosis_sidechain_chann_id=$(hermes --json query channels --chain $HERMES_OSMOSIS_NAME --counterparty-chain $HERMES_SIDECHAIN_NAME | jq -r 'select(.result) | .result[-1].channel_id')
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
osmosisd tx wasm instantiate $crosschain_swaps_code_id "$init_crosschain_swaps_msg" --label "crosschain_swaps" --from ${deployer} --admin ${deployer} "${TX_FLAGS[@]}" || exit 1
sleep 6
export crosschain_swaps_address=$(osmosisd query wasm list-contract-by-code "$crosschain_swaps_code_id" -o json | jq -r '.contracts[-1]')
echo "crosschain_swaps address: $crosschain_swaps_address"
