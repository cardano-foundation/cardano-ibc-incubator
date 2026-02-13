#==================================Assign contract address=======================================
CROSSCHAIN_SWAPS_ADDRESS=""
[ -z "$CROSSCHAIN_SWAPS_ADDRESS" ] && echo "crosschain_swaps contract address not specified!" && exit 1
CARDANO_RECEIVER="247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8"
#==================================Define util funcions=======================================
check_string_empty() {
  [ -z "$1" ] && echo "$2" && exit 1
}

script_dir=$(dirname "$(realpath "$0")")
repo_root="$script_dir"
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

print_swap_diagnostics() {
    echo "=== Diagnostics: Cardano->Entrypoint packet pending ==="
    "$HERMES_BIN" query packet pending --chain "$HERMES_CARDANO_NAME" --port transfer --channel "$cardano_sidechain_chann_id" || true

    echo "=== Diagnostics: Entrypoint->Cardano packet pending ==="
    "$HERMES_BIN" query packet pending --chain "$HERMES_SIDECHAIN_NAME" --port transfer --channel "$sidechain_cardano_chann_id" || true

    echo "=== Diagnostics: Entrypoint->Osmosis packet pending ==="
    "$HERMES_BIN" query packet pending --chain "$HERMES_SIDECHAIN_NAME" --port transfer --channel "$sidechain_osmosis_chann_id" || true

    echo "=== Diagnostics: Osmosis->Entrypoint packet pending ==="
    "$HERMES_BIN" query packet pending --chain "$HERMES_OSMOSIS_NAME" --port transfer --channel "$osmosis_sidechain_chann_id" || true
}

channel_commitments_cleared() {
    _chain="$1"
    _channel="$2"

    _out=$("$HERMES_BIN" query packet commitments --chain "$_chain" --port transfer --channel "$_channel" 2>&1)
    _status=$?
    if [ "$_status" -ne 0 ]; then
        echo "Failed to query packet commitments for chain=${_chain}, channel=${_channel}: ${_out}" >&2
        return 2
    fi

    if printf '%s\n' "$_out" | grep -Eq 'seqs:[[:space:]]*\[[[:space:]]*\]'; then
        return 0
    fi

    if printf '%s\n' "$_out" | grep -qi 'no packet commitments found'; then
        return 0
    fi

    if printf '%s\n' "$_out" | grep -Eq 'seqs:[[:space:]]*\['; then
        return 1
    fi

    echo "Unexpected packet commitments output for chain=${_chain}, channel=${_channel}:" >&2
    echo "$_out" >&2
    return 2
}

wait_for_swap_settlement() {
    _timeout_seconds="${1:-600}"
    _poll_interval="${2:-10}"
    _start_epoch=$(date +%s)
    _attempt=1

    while true; do
        _pending=0
        _unknown=0

        channel_commitments_cleared "$HERMES_CARDANO_NAME" "$cardano_sidechain_chann_id"; _result=$?
        [ "$_result" -eq 1 ] && _pending=1
        [ "$_result" -eq 2 ] && _unknown=1

        channel_commitments_cleared "$HERMES_SIDECHAIN_NAME" "$sidechain_cardano_chann_id"; _result=$?
        [ "$_result" -eq 1 ] && _pending=1
        [ "$_result" -eq 2 ] && _unknown=1

        channel_commitments_cleared "$HERMES_SIDECHAIN_NAME" "$sidechain_osmosis_chann_id"; _result=$?
        [ "$_result" -eq 1 ] && _pending=1
        [ "$_result" -eq 2 ] && _unknown=1

        channel_commitments_cleared "$HERMES_OSMOSIS_NAME" "$osmosis_sidechain_chann_id"; _result=$?
        [ "$_result" -eq 1 ] && _pending=1
        [ "$_result" -eq 2 ] && _unknown=1

        if [ "$_pending" -eq 0 ] && [ "$_unknown" -eq 0 ]; then
            echo "All transfer packet commitments are cleared."
            return 0
        fi

        _elapsed=$(( $(date +%s) - _start_epoch ))
        if [ "$_elapsed" -ge "$_timeout_seconds" ]; then
            echo "Timed out after ${_timeout_seconds}s waiting for packet acknowledgements and commitment clearing."
            print_swap_diagnostics
            return 1
        fi

        if [ $(( _attempt % 6 )) -eq 0 ]; then
            echo "Still waiting for transfer settlement (${_elapsed}s elapsed)..."
            print_swap_diagnostics
        fi

        sleep "$_poll_interval"
        _attempt=$(( _attempt + 1 ))
    done
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
check_string_empty "$sidechain_cardano_chann_id" "Entrypoint chain->Cardano channel not found. Exiting..."
echo "Entrypoint chain->Cardano channel id: $sidechain_cardano_chann_id"

sidechain_osmosis_chann_id=$(get_latest_transfer_channel_id "$HERMES_SIDECHAIN_NAME" "$HERMES_OSMOSIS_NAME")
check_string_empty "$sidechain_osmosis_chann_id" "Entrypoint chain->Osmosis channel not found. Exiting..."
echo "Entrypoint chain->Osmosis channel id: $sidechain_osmosis_chann_id"

osmosis_sidechain_chann_id=$(get_latest_transfer_channel_id "$HERMES_OSMOSIS_NAME" "$HERMES_SIDECHAIN_NAME")
check_string_empty "$osmosis_sidechain_chann_id" "Osmosis->Entrypoint chain channel not found. Exiting..."
echo "Osmosis->Entrypoint chain channel id: $osmosis_sidechain_chann_id"

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
echo "Waiting for transfer acknowledgements and commitment clearing..."
wait_for_swap_settlement 600 10 || exit 1
echo "Crosschain swap tx done!"
