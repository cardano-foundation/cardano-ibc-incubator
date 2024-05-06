#!/bin/bash

# osmosis version v24.0.0

SCRIPT_DIR=$(dirname $(realpath $0))
cd  ${SCRIPT_DIR}/.. && make localnet-startd && make localnet-keys
args="--keyring-backend test --chain-id localosmosis --gas-prices 0.1uosmo --gas auto --gas-adjustment 1.3 -y"
TX_FLAGS=($args)


VALIDATOR=$(osmosisd keys show val --keyring-backend test -a)


# Build contracts 
cd ${SCRIPT_DIR}/../cosmwasm && bash ./build_wasm.sh

# Gen code_id swaprouter
cd ${SCRIPT_DIR}/../cosmwasm/artifacts && osmosisd --node http://localhost:26658 tx wasm store swaprouter.wasm --from ${VALIDATOR} "${TX_FLAGS[@]}"
sleep 5
SWAPRUOTER_CODE_ID=$(osmosisd --node http://localhost:26658 query wasm list-code -o json | jq -r '.code_infos[-1].code_id')
echo "SWAPRUOTER_CODE_ID" $SWAPRUOTER_CODE_ID
# Initial contract swaprouter
MSG=$(cat <<EOF
{
  "owner": "${VALIDATOR}"
}
EOF
)
sleep 3
osmosisd tx wasm instantiate $SWAPRUOTER_CODE_ID "$MSG"  --label "swaprouter" --from ${VALIDATOR} --admin ${VALIDATOR} "${TX_FLAGS[@]}" --node http://localhost:26658
sleep 3
export SWAPROUTER_ADDRESS=$(osmosisd --node http://localhost:26658 query wasm list-contract-by-code "$SWAPRUOTER_CODE_ID" -o json | jq -r '.contracts[-1]')
echo "SWAPROUTER_ADDRESS" $SWAPROUTER_ADDRESS
# Set up channel
## Using hermes 
rm ${HOME}/.hermes/config.toml && cp ${SCRIPT_DIR}/hermes/config.toml ${HOME}/.hermes/config.toml
hermes keys add --chain sidechain --mnemonic-file ${SCRIPT_DIR}/hermes/cosmos
hermes keys add --chain localosmosis --mnemonic-file ${SCRIPT_DIR}/hermes/osmosis

localosmosis_client_id=$(awk -F 'client_id: ClientId("([^"]+)"),' '
  { max = (split($1, suffixes, "-") > max ? suffixes[3] : max ) }
  END { print "07-tendermint-" max }
' <<< "$(hermes create client --host-chain localosmosis --reference-chain sidechain)")
localosmosis_client_id=${localosmosis_client_id::-2}

sidechain_client_id=$(awk -F 'client_id: ClientId("([^"]+)"),' '
  { max = (split($1, suffixes, "-") > max ? suffixes[3] : max ) }
  END { print "07-tendermint-" max }
' <<< "$(hermes create client --host-chain sidechain --reference-chain localosmosis --trusting-period 86000s)")
sidechain_client_id=${sidechain_client_id::-2}


hermes create connection --a-chain sidechain --a-client $sidechain_client_id --b-client $localosmosis_client_id
connectionId=$(hermes --json query connections --chain sidechain | jq -r '.result[-2]' | tail -n 1)

channelId=$(hermes --json create channel --a-chain sidechain --a-connection $connectionId --a-port transfer --b-port transfer|  jq -r '.result.b_side.channel_id' | tail -n 1) 

# Gen code_id crosschain_swap
sleep 3
cd ${SCRIPT_DIR}/../cosmwasm/artifacts && osmosisd --node http://localhost:26658 tx wasm store crosschain_swaps.wasm --from ${VALIDATOR} "${TX_FLAGS[@]}" 
sleep 5
CROSSCHAINSWAPS_CODE_ID=$(osmosisd --node http://localhost:26658 query wasm list-code -o json | jq -r '.code_infos[-1].code_id')
echo "CROSSCHAINSWAPS_CODE_ID" $CROSSCHAINSWAPS_CODE_ID
# Initial contract crosschain_swap
MSG=$(cat <<EOF
{"governor":"${VALIDATOR}","swap_contract":"${SWAPROUTER_ADDRESS}","channels":[["cosmos","${channelId}"]]}
EOF
)
sleep 3
osmosisd tx wasm instantiate $CROSSCHAINSWAPS_CODE_ID "$MSG" --label "crosschain_swaps" --from ${VALIDATOR} --admin ${VALIDATOR} "${TX_FLAGS[@]}" --node http://localhost:26658
sleep 3
export CROSSCHAINSWAPS_ADDRESS=$(osmosisd --node http://localhost:26658 query wasm list-contract-by-code "$CROSSCHAINSWAPS_CODE_ID" -o json | jq -r '.contracts[-1]')
echo "CROSSCHAINSWAPS_ADDRESS" $CROSSCHAINSWAPS_ADDRESS