#==================================Assign contract address=======================================
CROSSCHAIN_SWAPS_ADDRESS=""
[ -z "$CROSSCHAIN_SWAPS_ADDRESS" ] && echo "crosschain_swaps contract address not specified!" && exit 1
CARDANO_RECEIVER="247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8"
#==================================Define util funcions=======================================
check_string_empty() {
  [ -z $1 ] && echo "$2" && exit 1
}

# Function to resolve the latest transfer channel id between two Hermes chains
get_latest_transfer_channel_id() {
    _channel_chain="$1"
    _counterparty_chain="$2"

    _channel_id=$(
        hermes --json query channels --chain "$_channel_chain" --counterparty-chain "$_counterparty_chain" 2>/dev/null |
            jq -r '
                select(.result) |
                (if (.result | type) == "array" then .result[-1] else .result end) |
                .channel_id // .channel_a // empty
            ' 2>/dev/null | tail -n 1
    )

    if [ -z "$_channel_id" ]; then
        _channel_id=$(
            hermes query channels --chain "$_channel_chain" --counterparty-chain "$_counterparty_chain" 2>/dev/null |
                tr '[:space:]' '\n' |
                grep '^channel-' |
                head -n 1
        )
    fi

    echo "$_channel_id"
}

HERMES_CARDANO_NAME="cardano-devnet"
HERMES_SIDECHAIN_NAME="sidechain"
HERMES_OSMOSIS_NAME="localosmosis"
SENT_AMOUNT="12345-465209195f27c99dfefdcb725e939ad3262339a9b150992b66673be86d6f636b"
SIDECHAIN_RECEIVER="pfm"

cardano_sidechain_chann_id=$(get_latest_transfer_channel_id "$HERMES_CARDANO_NAME" "$HERMES_SIDECHAIN_NAME")
check_string_empty "$cardano_sidechain_chann_id" "Cardano->Entrypoint chain channel not found. Exiting..."
echo "Cardano->Entrypoint chain channel id: $cardano_sidechain_chann_id"

sidechain_cardano_chann_id=$(get_latest_transfer_channel_id "$HERMES_SIDECHAIN_NAME" "$HERMES_CARDANO_NAME")
echo "Entrypoint chain->Cardano channel id: $sidechain_cardano_chann_id"

sidechain_osmosis_chann_id=$(get_latest_transfer_channel_id "$HERMES_SIDECHAIN_NAME" "$HERMES_OSMOSIS_NAME")
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
sent_amount="${SENT_AMOUNT%%-*}"
sent_denom="${SENT_AMOUNT#*-}"
check_string_empty "$sent_amount" "Transfer amount not found in SENT_AMOUNT. Exiting..."
check_string_empty "$sent_denom" "Transfer denom not found in SENT_AMOUNT. Exiting..."

hermes tx ft-transfer \
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
echo "Waiting for transfer tx complete..."
sleep 600
echo "Crosschain swap tx done!"
