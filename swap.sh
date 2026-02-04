#==================================Assign contract address=======================================
CROSSCHAIN_SWAPS_ADDRESS=""
[ -z "$CROSSCHAIN_SWAPS_ADDRESS" ] && echo "crosschain_swaps contract address not specified!" && exit 1
CARDANO_RECEIVER="247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8"
#==================================Define util funcions=======================================
check_string_empty() {
  [ -z $1 ] && echo "$2" && exit 1
}
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
SENT_AMOUNT="12345-465209195f27c99dfefdcb725e939ad3262339a9b150992b66673be86d6f636b"
SIDECHAIN_RECEIVER="pfm"
HERMES_OSMOSIS_NAME="localosmosis"
HERMES_SIDECHAIN_NAME="sidechain"

cardano_sidechain_conn_id=$($rly config show --json | jq -r --arg path "$RELAYER_PATH" '.paths[$path].src."connection-id"')
check_string_empty "$cardano_sidechain_conn_id" "Cardano<->Entrypoint chain connection not found. Exiting..."

cardano_sidechain_chann_id=$($rly query connection-channels "$CARDANO_CHAIN_NAME" "$cardano_sidechain_conn_id" --reverse --limit 1 | jq -r '.[0].channel_id')
check_string_empty "$cardano_sidechain_chann_id" "Cardano->Entrypoint chain channel not found. Exiting..."
echo "Cardano->Entrypoint chain channel id: $cardano_sidechain_chann_id"

sidechain_cardano_chann_id=$($rly query connection-channels "$CARDANO_CHAIN_NAME" "$cardano_sidechain_conn_id" --reverse --limit 1 | jq -r '.counterparty.channel_id')
echo "Entrypoint chain->Cardano channel id: $sidechain_cardano_chann_id"

sidechain_osmosis_chann_id=$(hermes --json query channels --chain "$HERMES_OSMOSIS_NAME" --counterparty-chain "$HERMES_SIDECHAIN_NAME" --show-counterparty | jq -r 'select(.result) | .result[-1].channel_b')
check_string_empty "$sidechain_osmosis_chann_id" "Entrypoint chain->Osmosis channel not found. Exiting..."
echo "Entrypoint chain->Osmosis channel id: $sidechain_osmosis_chann_id"

memo=$(
    jq -nc \
        --arg receiver "$CROSSCHAIN_SWAPS_ADDRESS" \
        --arg so_channel "$sidechain_osmosis_chann_id" \
        --arg cardano_receiver "$CARDANO_RECEIVER" \
        --arg sc_channel "$sidechain_cardano_chann_id" \
        '{forward: {
            receiver: $receiver,
            port: "transfer",
            channel: $so_channel,
            next: {
            wasm: {
                contract: $receiver,
                msg: {
                osmosis_swap: {
                    output_denom: "uosmo",
                    slippage: {
                    min_output_amount: "1",
                    },
                    receiver: "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6",
                    on_failed_delivery: "do_nothing",
                    next_memo: {
                    forward: {
                        receiver:
                        $cardano_receiver,
                        port: "transfer",
                        channel: $sc_channel,
                    },
                    },
                },
                },
            },
            },
        }}'
)
echo $memo

#==================================Send Cardano token to Osmosis=======================================
$rly transact transfer $CARDANO_CHAIN_NAME $SIDECHAIN_CHAIN_NAME $SENT_AMOUNT $SIDECHAIN_RECEIVER $cardano_sidechain_chann_id \
    --path $RELAYER_PATH --timeout-time-offset 1h \
    --memo $memo ||
    exit 1
echo "Waiting for transfer tx complete..."
sleep 600
echo "Crosschain swap tx done!"
