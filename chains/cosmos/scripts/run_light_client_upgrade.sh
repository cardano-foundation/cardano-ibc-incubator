#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=chains/cosmos/scripts/run_light_client_recovery.sh
source "$script_dir/run_light_client_recovery.sh"
repo_root="${CARIBIC_PROJECT_ROOT:-$(cd "$script_dir/../../.." && pwd -P)}"
HERMES_BIN="${HERMES_BIN:-$repo_root/relayer/target/release/hermes}"
DIRECT_TOKEN_SWAP_SCRIPT="${DIRECT_TOKEN_SWAP_SCRIPT:-$script_dir/run_direct_token_swap.sh}"
HANDLER_JSON="${HANDLER_JSON:-$repo_root/cardano/offchain/deployments/handler.json}"
COSMOS_PROFILE="${COSMOS_PROFILE:-v8-classic}"
case "$COSMOS_PROFILE" in v8-classic|v10-classic) ;; *) fail "Only IBC Classic profiles are supported." ;; esac
COSMOS_CHAIN_ID="${COSMOS_CHAIN_ID:-${COSMOS_PROFILE}-1}"
CARDANO_CHAIN_ID="${CARDANO_CHAIN_ID:-cardano-devnet}"
SIMD_HOME="${SIMD_HOME:-/var/lib/simd}"
SIMD_NODE="${SIMD_NODE:-tcp://127.0.0.1:26657}"
POLL_INTERVAL_SECONDS="${UPGRADE_POLL_INTERVAL_SECONDS:-2}"
QUERY_TIMEOUT_SECONDS="${UPGRADE_QUERY_TIMEOUT_SECONDS:-60}"
COMMAND_TIMEOUT_SECONDS="${UPGRADE_COMMAND_TIMEOUT_SECONDS:-1800}"
PACKET_TIMEOUT_SECONDS="${UPGRADE_PACKET_TIMEOUT_SECONDS:-600}"
RECOVERY_TRANSFER_AMOUNT="${UPGRADE_TRANSFER_AMOUNT:-12345}"
UPGRADE_REQUIRE_SAME_MODULES="${UPGRADE_REQUIRE_SAME_MODULES:-true}"
case "$UPGRADE_REQUIRE_SAME_MODULES" in true|false) ;; *) fail "UPGRADE_REQUIRE_SAME_MODULES must be true or false." ;; esac
for name in QUERY_TIMEOUT_SECONDS COMMAND_TIMEOUT_SECONDS PACKET_TIMEOUT_SECONDS RECOVERY_TRANSFER_AMOUNT; do
  require_positive_integer "${!name}" "$name"
done
require_nonnegative_integer "$POLL_INTERVAL_SECONDS" POLL_INTERVAL_SECONDS
require_value "${UPGRADE_CONTROL_SCRIPT:-}" "UPGRADE_CONTROL_SCRIPT is required (start, identity, upgrade actions)."
require_value "${UPGRADE_EVIDENCE_DIR:-}" "UPGRADE_EVIDENCE_DIR must name a new directory."
require_value "${SIMD_BIN:-}" "SIMD_BIN must query the isolated test host through an executable wrapper."
for file in "$HERMES_BIN" "$UPGRADE_CONTROL_SCRIPT" "$SIMD_BIN"; do
  [[ -x "$file" ]] || fail "Executable not found: $file"
done
[[ -f "$HANDLER_JSON" && -f "$DIRECT_TOKEN_SWAP_SCRIPT" ]] || fail "Missing deployment or transfer script."
CARDANO_SEND_DENOM="${CARDANO_SEND_DENOM:-$(jq -er '.tokens.mock | select(type == "string" and length > 0)' "$HANDLER_JSON")}"
mkdir "$UPGRADE_EVIDENCE_DIR" # Never overwrite evidence from a previous attempt.
cp "$HANDLER_JSON" "$UPGRADE_EVIDENCE_DIR/handler-before.json"
export COSMOS_PROFILE COSMOS_CHAIN_ID SIMD_HOME SIMD_NODE

identity() {
  run_with_timeout "$QUERY_TIMEOUT_SECONDS" "$UPGRADE_CONTROL_SCRIPT" identity | jq -ceS '
    if (.binary_sha256 | type == "string" and test("^[0-9a-f]{64}$"))
      and (.modules | type == "object")
      and all([.modules.adapter, .modules.core][];
        (.version | type == "string" and test("^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$"))
        and (.commit | type == "string" and test("^[0-9a-f]{40}$")))
    then . else error("invalid running-binary provenance") end'
}

snapshot() {
  local route state invariants ids cardano_ids cardano_channel voucher trace commitments_cardano commitments_cosmos sequences
  route="$(query_route_snapshot)"
  state="$(query_client_state "$SUBJECT_CLIENT_ID")"
  invariants="$(client_recovery_invariants "$state")"
  ids="$(query_cardano_client_ids)"
  cardano_ids="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query clients --host-chain "$CARDANO_CHAIN_ID" --reference-chain "$COSMOS_CHAIN_ID")"
  cardano_ids="$(jq -ce 'if type == "array" and all(.[]; type == "string" and test("^07-tendermint-[0-9]+$")) then sort else error("invalid Cardano client list") end' <<<"$cardano_ids")"
  cardano_channel="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query channel end --chain "$CARDANO_CHAIN_ID" --port transfer --channel "$CARDANO_COSMOS_CHANNEL_ID")"
  voucher="$(query_voucher_snapshot "$COSMOS_RECEIVER")"
  trace="$(query_voucher_trace "$(jq -r .denom <<<"$voucher")")"
  commitments_cardano="$(wait_for_commitment_sequences "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID")"
  commitments_cosmos="$(wait_for_commitment_sequences "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID")"
  sequences="$(query_channel_sequences)"
  jq -cnS --argjson route "$route" --argjson state "$state" --argjson invariants "$invariants" --argjson ids "$ids" \
    --argjson cardano_ids "$cardano_ids" --argjson cardano_channel "$cardano_channel" \
    --argjson voucher "$voucher" --argjson trace "$trace" \
    --argjson commitments_cardano "$commitments_cardano" --argjson commitments_cosmos "$commitments_cosmos" \
    --argjson sequences "$sequences" \
    '{route:$route,client_state:$state,client_invariants:$invariants,client_ids:$ids,cardano_client_ids:$cardano_ids,
      cardano_channel:$cardano_channel,voucher:$voucher,trace:$trace,
      cardano_commitments:$commitments_cardano,cosmos_commitments:$commitments_cosmos,sequences:$sequences}'
}

echo "Starting the released host on an isolated, empty Cosmos database..."
run_with_timeout "$COMMAND_TIMEOUT_SECONDS" "$UPGRADE_CONTROL_SCRIPT" start
identity >"$UPGRADE_EVIDENCE_DIR/before-binary.json"
initial_client_ids="$(query_cardano_client_ids)"
[[ "$initial_client_ids" == '[]' ]] || fail "The before host must start without existing Cardano clients."
channel="$(hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show create channel \
  --a-chain "$CARDANO_CHAIN_ID" --b-chain "$COSMOS_CHAIN_ID" \
  --a-port transfer --b-port transfer --new-client-connection --yes)"
printf '%s\n' "$channel" >"$UPGRADE_EVIDENCE_DIR/created-route.json"
CARDANO_COSMOS_CHANNEL_ID="$(jq -er '.a_side.channel_id | select(test("^channel-[0-9]+$"))' <<<"$channel")"
COSMOS_CARDANO_CHANNEL_ID="$(jq -er '.b_side.channel_id | select(test("^channel-[0-9]+$"))' <<<"$channel")"
CONNECTION_ID="$(discover_connection_id)"
SUBJECT_CLIENT_ID="$(discover_subject_client_id)"
COSMOS_RECEIVER="$(query_cosmos_relayer_address)"

echo "Relaying and acknowledging a packet before the upgrade..."
run_forward_token_transfer 2>&1 | tee "$UPGRADE_EVIDENCE_DIR/before-transfer.log"
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == Active ]] || fail "Original client is not Active."
snapshot >"$UPGRADE_EVIDENCE_DIR/before.json"

# No background relayer may mutate the test host between these snapshots.
# The control must replace only the host executable and preserve its data home.
echo "Replacing the host binary while retaining the database..."
run_with_timeout "$COMMAND_TIMEOUT_SECONDS" "$UPGRADE_CONTROL_SCRIPT" upgrade
identity >"$UPGRADE_EVIDENCE_DIR/after-binary.json"
[[ "$(jq -r .binary_sha256 "$UPGRADE_EVIDENCE_DIR/before-binary.json")" != \
   "$(jq -r .binary_sha256 "$UPGRADE_EVIDENCE_DIR/after-binary.json")" ]] || fail "The host binary was not replaced."
if [[ "$UPGRADE_REQUIRE_SAME_MODULES" == true ]]; then
  [[ "$(jq -cS .modules "$UPGRADE_EVIDENCE_DIR/before-binary.json")" == \
     "$(jq -cS .modules "$UPGRADE_EVIDENCE_DIR/after-binary.json")" ]] || fail "The no-new-release scenario changed light-client modules."
fi
snapshot >"$UPGRADE_EVIDENCE_DIR/after-restart.json"
cmp "$UPGRADE_EVIDENCE_DIR/before.json" "$UPGRADE_EVIDENCE_DIR/after-restart.json" ||
  fail "Host replacement changed retained client, route, packet, or voucher state."
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == Active ]] || fail "Retained client is not Active after replacement."

echo "Relaying the post-upgrade packet through the original client and channel..."
run_forward_token_transfer 2>&1 | tee "$UPGRADE_EVIDENCE_DIR/after-transfer.log"
snapshot >"$UPGRADE_EVIDENCE_DIR/after-transfer.json"
jq -e -s --argjson amount "$RECOVERY_TRANSFER_AMOUNT" '
  .[0] as $before | .[1] as $after |
  $after.client_state.latest_height.revision_height > $before.client_state.latest_height.revision_height
  and $after.client_state.latest_height.revision_number == $before.client_state.latest_height.revision_number
  and $after.client_state.latest_checkpoint_height.revision_height > $before.client_state.latest_checkpoint_height.revision_height
  and $after.client_state.chain_id == $before.client_state.chain_id
  and $after.client_state.trusting_period == $before.client_state.trusting_period
  and $after.sequences.next_sequence_send == $before.sequences.next_sequence_send
  and $after.sequences.next_sequence_receive >= $before.sequences.next_sequence_receive
  and $after.voucher.denom == $before.voucher.denom
  and (($after.voucher.amount|tonumber) - ($before.voucher.amount|tonumber) == $amount)
  and ($after | del(.client_state,.voucher,.sequences)) == ($before | del(.client_state,.voucher,.sequences))
' "$UPGRADE_EVIDENCE_DIR/before.json" "$UPGRADE_EVIDENCE_DIR/after-transfer.json" >/dev/null ||
  fail "Post-upgrade transfer did not advance the original client or preserve route/voucher identity."
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == Active ]] || fail "Retained client is not Active after its ordinary update."
cmp "$HANDLER_JSON" "$UPGRADE_EVIDENCE_DIR/handler-before.json" || fail "Cardano deployment descriptor changed."
printf '%s\n' "PASS: $SUBJECT_CLIENT_ID updated and relayed on $CONNECTION_ID/$COSMOS_CARDANO_CHANNEL_ID after host replacement." |
  tee "$UPGRADE_EVIDENCE_DIR/PASS"
