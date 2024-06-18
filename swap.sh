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
SENT_AMOUNT="12345-9fc33a6ffaa8d1f600c161aa383739d5af37807ed83347cc133521c96d6f636b"
SIDECHAIN_RECEIVER="pfm"
HERMES_OSMOSIS_NAME="localosmosis"
HERMES_SIDECHAIN_NAME="sidechain"
CROSSCHAIN_SWAPS_ADDRESS="osmo1nc5tatafv6eyq7llkr2gv50ff9e22mnf70qgjlv737ktmt4eswrqvlx82r"
CARDANO_RECEIVER="247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8"

cardano_sidechain_conn_id=$($rly config show --json | jq -r --arg path "$RELAYER_PATH" '.paths[$path].src."connection-id"')

cardano_sidechain_chann_id=$($rly query connection-channels $CARDANO_CHAIN_NAME $cardano_sidechain_conn_id --reverse --limit 1 | jq -r '.channel_id')
echo "Cardano->Sidechain channel id: $cardano_sidechain_chann_id"

sidechain_cardano_chann_id=$($rly query connection-channels $CARDANO_CHAIN_NAME $cardano_sidechain_conn_id --reverse --limit 1 | jq -r '.counterparty.channel_id')
echo "Sidechain->Cardano channel id: $sidechain_cardano_chann_id"

sidechain_osmosis_chann_id=$(hermes --json query channels --chain $HERMES_OSMOSIS_NAME --counterparty-chain $HERMES_SIDECHAIN_NAME --show-counterparty | jq -r 'select(.result) | .result[-1].channel_b')
echo "Sidechain->Osmosis channel id: $sidechain_osmosis_chann_id"

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
sleep 60
echo "Crosschain swap tx done!"
