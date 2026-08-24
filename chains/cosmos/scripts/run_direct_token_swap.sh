#!/usr/bin/env bash

set -Eeuo pipefail

SUCCESS_ACKNOWLEDGEMENT_HEX="7B22726573756C74223A2241513D3D227D"

require_value() {
  if [[ -z "$1" ]]; then
    echo "$2" >&2
    exit 1
  fi
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  "$@" &
  local command_pid=$!
  local start_seconds=$SECONDS
  local timed_out=false

  while kill -0 "$command_pid" 2>/dev/null; do
    if (( SECONDS - start_seconds >= timeout_seconds )); then
      timed_out=true
      kill -TERM "$command_pid" 2>/dev/null || true
      local grace_start_seconds=$SECONDS
      while kill -0 "$command_pid" 2>/dev/null &&
        (( SECONDS - grace_start_seconds < 5 )); do
        sleep 0.05
      done
      if kill -0 "$command_pid" 2>/dev/null; then
        kill -KILL "$command_pid" 2>/dev/null || true
      fi
      break
    fi
    sleep 0.05
  done

  local status=0
  if wait "$command_pid"; then
    status=0
  else
    status=$?
  fi

  if [[ "$timed_out" == "true" ]]; then
    echo "Command timed out after ${timeout_seconds}s: $*" >&2
    status=124
  fi
  return "$status"
}

# Hermes emits JSON logs followed by a single status envelope. Return only that
# envelope's result and never reinterpret a failed query as an empty result.
hermes_json_result() {
  local timeout_seconds="$1"
  local output_mode="$2"
  shift 2

  local output
  local status=0
  if output="$(run_with_timeout "$timeout_seconds" "$HERMES_BIN" --json "$@" 2>&1)"; then
    status=0
  else
    status=$?
  fi

  local envelope=""
  if envelope="$(
    printf '%s\n' "$output" | jq -Rsce '
      [split("\n")[] | fromjson? | select(type == "object" and has("status"))]
      | if length == 0 then error("Hermes did not emit a status envelope") else last end
    ' 2>/dev/null
  )"; then
    :
  else
    envelope=""
  fi

  if (( status != 0 )) || [[ -z "$envelope" ]] || ! jq -e '.status == "success"' >/dev/null <<<"$envelope"; then
    if [[ "$output_mode" == "stability" ]] &&
      { [[ "$output" == *"HEIGHT_NOT_ACCEPTED"* ]] || [[ "$output" == *"stability thresholds not met"* ]]; }; then
      return 75
    fi
    printf '%s\n' "$output" >&2
    if (( status != 0 )); then
      return "$status"
    fi
    return 1
  fi

  if [[ "$output_mode" == "show" ]]; then
    printf '%s\n' "$output" >&2
  fi
  jq -c '.result' <<<"$envelope"
}

query_commitment_state() {
  local chain="$1"
  local channel="$2"
  local mode="${3:-quiet}"
  local result
  result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" "$mode" query packet commitments \
    --chain "$chain" \
    --port transfer \
    --channel "$channel")" || return $?
  jq -ce '
    if type == "object"
      and (.height.revision_height | type) == "number"
      and (.seqs | type) == "array"
      and all(.seqs[]; type == "number")
    then .
    else error("invalid packet commitment response")
    end
  ' <<<"$result"
}

wait_for_stable_commitment_state() {
  local chain="$1"
  local channel="$2"
  local deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))

  while true; do
    local mode="quiet"
    [[ "$chain" == "$CARDANO_CHAIN_ID" ]] && mode="stability"

    local state
    local status=0
    if state="$(query_commitment_state "$chain" "$channel" "$mode")"; then
      printf '%s\n' "$state"
      return 0
    else
      status=$?
    fi

    if (( status != 75 )); then
      return "$status"
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for a stability-accepted commitment state on ${chain}/${channel}." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_commitment() {
  local chain="$1"
  local channel="$2"
  local sequence="$3"
  local deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))

  while true; do
    local state
    state="$(wait_for_stable_commitment_state "$chain" "$channel")" || return $?
    if jq -e --argjson sequence "$sequence" '.seqs | index($sequence) != null' >/dev/null <<<"$state"; then
      printf '%s\n' "$state"
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for packet ${sequence} on ${chain}/${channel}." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_commitment_absent() {
  local chain="$1"
  local channel="$2"
  local sequence="$3"
  local deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))

  while true; do
    local state
    state="$(wait_for_stable_commitment_state "$chain" "$channel")" || return $?
    if ! jq -e --argjson sequence "$sequence" '.seqs | index($sequence) != null' >/dev/null <<<"$state"; then
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for packet ${sequence} to settle on ${chain}/${channel}." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_acknowledgement_proof() {
  local chain="$1"
  local channel="$2"
  local sequence="$3"
  local deadline=$(( $(date +%s) + SETTLEMENT_TIMEOUT_SECONDS ))

  while true; do
    local mode="quiet"
    [[ "$chain" == "$CARDANO_CHAIN_ID" ]] && mode="stability"

    local result
    local status=0
    if result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" "$mode" query packet acks \
      --chain "$chain" \
      --port transfer \
      --channel "$channel")"; then
      if jq -e --argjson sequence "$sequence" '
        type == "object"
          and (.height.revision_height | type) == "number"
          and (.seqs | type) == "array"
          and (.seqs | index($sequence) != null)
      ' >/dev/null <<<"$result"; then
        printf '%s\n' "$result"
        return 0
      fi
    else
      status=$?
      if (( status != 75 )); then
        return "$status"
      fi
    fi

    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for acknowledgement ${sequence} on ${chain}/${channel}." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

discover_cardano_client_id() {
  local channel_result
  channel_result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query channel end \
    --chain "$COSMOS_CHAIN_ID" \
    --port transfer \
    --channel "$COSMOS_CARDANO_CHANNEL_ID")" || return $?
  local connection_id
  connection_id="$(jq -er '
    if type == "object"
      and (.connection_hops | type) == "array"
      and (.connection_hops | length) == 1
      and (.connection_hops[0] | type) == "string"
    then .connection_hops[0]
    else error("expected exactly one connection hop on the Cosmos transfer channel")
    end
  ' <<<"$channel_result")" || return $?

  local connection_result
  connection_result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query connection end \
    --chain "$COSMOS_CHAIN_ID" \
    --connection "$connection_id")" || return $?
  jq -er '
    if type == "object" and (.client_id | type) == "string"
    then .client_id
    else error("Cosmos transfer connection has no client identifier")
    end
  ' <<<"$connection_result"
}

catch_up_cardano_client() {
  local target_height="$1"

  if [[ -z "${CARDANO_CLIENT_ID:-}" ]]; then
    CARDANO_CLIENT_ID="$(discover_cardano_client_id)"
  fi

  local client_state
  client_state="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query client state \
    --chain "$COSMOS_CHAIN_ID" \
    --client "$CARDANO_CLIENT_ID")" || return $?
  local latest_height
  latest_height="$(jq -er '.latest_height.revision_height' <<<"$client_state")"

  if (( latest_height < target_height )); then
    echo "Catching ${COSMOS_PROFILE} Cardano client ${CARDANO_CLIENT_ID} up to proof height ${target_height}..."
    hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show update client \
      --host-chain "$COSMOS_CHAIN_ID" \
      --client "$CARDANO_CLIENT_ID" \
      --height "$target_height" >/dev/null
  fi

  # A probabilistic checkpoint has no IBC root. Requiring this exact consensus
  # state proves that Hermes completed the checkpoint chain and installed the
  # root-bearing update before a proof-bearing packet transaction is built.
  hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query client consensus \
    --chain "$COSMOS_CHAIN_ID" \
    --client "$CARDANO_CLIENT_ID" \
    --consensus-height "$target_height" >/dev/null
}

submit_transfer() {
  local src_chain="$1"
  local dst_chain="$2"
  local src_channel="$3"
  local amount="$4"
  local denom="$5"
  local receiver="$6"

  local result
  result="$(hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show tx ft-transfer \
    --src-chain "$src_chain" \
    --dst-chain "$dst_chain" \
    --src-port transfer \
    --src-channel "$src_channel" \
    --amount "$amount" \
    --denom "$denom" \
    --receiver "$receiver" \
    --timeout-seconds 3600)" || return $?

  jq -ce '
    [.[] | select(.event.SendPacket != null) | {
      sequence: .event.SendPacket.packet.sequence
    }]
    | if length == 1
        and (.[0].sequence | type) == "number"
      then .[0]
      else error("transfer did not emit exactly one SendPacket event")
      end
  ' <<<"$result"
}

relay_receive() {
  local src_chain="$1"
  local dst_chain="$2"
  local src_channel="$3"
  local sequence="$4"

  local result
  result="$(hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show tx packet-recv \
    --src-chain "$src_chain" \
    --dst-chain "$dst_chain" \
    --src-port transfer \
    --src-channel "$src_channel" \
    --packet-sequences "$sequence")" || return $?

  jq -e --argjson sequence "$sequence" --arg success_ack "$SUCCESS_ACKNOWLEDGEMENT_HEX" '
    any(.[];
      .WriteAcknowledgement.packet.sequence == $sequence
        and (.WriteAcknowledgement.ack | ascii_upcase) == $success_ack
    )
  ' >/dev/null <<<"$result" || {
    echo "Packet ${sequence} did not produce the expected successful ICS-20 acknowledgement." >&2
    return 1
  }
}

relay_acknowledgement() {
  local src_chain="$1"
  local dst_chain="$2"
  local src_channel="$3"
  local sequence="$4"

  hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show tx packet-ack \
    --src-chain "$src_chain" \
    --dst-chain "$dst_chain" \
    --src-port transfer \
    --src-channel "$src_channel" \
    --packet-sequences "$sequence" >/dev/null
}

assert_commitments_match() {
  local chain="$1"
  local channel="$2"
  local expected="$3"
  local state
  state="$(wait_for_stable_commitment_state "$chain" "$channel")" || return $?
  jq -e --argjson expected "$expected" '.seqs == $expected' >/dev/null <<<"$state" || {
    echo "Packet commitments on ${chain}/${channel} differ from the pre-demo baseline." >&2
    echo "Expected: ${expected}" >&2
    echo "Actual: $(jq -c '.seqs' <<<"$state")" >&2
    return 1
  }
}

script_dir="$(dirname "$(realpath "$0")")"
repo_root="${CARIBIC_PROJECT_ROOT:-$(realpath "$script_dir/../../..")}" # resolved checkout root
HERMES_BIN="${HERMES_BIN:-$repo_root/relayer/target/release/hermes}"

[[ -x "$HERMES_BIN" ]] || {
  echo "Local Hermes binary not found at $HERMES_BIN." >&2
  echo "Run: cd $repo_root/relayer && cargo build --release --bin hermes" >&2
  exit 1
}

COSMOS_PROFILE="${COSMOS_PROFILE:-v8-classic}"
CARDANO_CHAIN_ID="${CARDANO_CHAIN_ID:-cardano-devnet}"
COSMOS_CHAIN_ID="${COSMOS_CHAIN_ID:-v8-classic-1}"
CARDANO_COSMOS_CHANNEL_ID="${CARDANO_COSMOS_CHANNEL_ID:-}"
COSMOS_CARDANO_CHANNEL_ID="${COSMOS_CARDANO_CHANNEL_ID:-}"
CARDANO_RECEIVER="${CARDANO_RECEIVER:-247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8}"
CARDANO_SEND_AMOUNT="${CARIBIC_TOKEN_SWAP_AMOUNT:-12345}"
COSMOS_RETURN_AMOUNT="${COSMOS_RETURN_AMOUNT:-12345}"
COSMOS_RETURN_DENOM="${COSMOS_RETURN_DENOM:-utest}"
HANDLER_JSON="${HANDLER_JSON:-$repo_root/cardano/offchain/deployments/handler.json}"
POLL_INTERVAL_SECONDS="${DEMO_POLL_INTERVAL_SECONDS:-5}"
SETTLEMENT_TIMEOUT_SECONDS="${DEMO_SETTLEMENT_TIMEOUT_SECONDS:-1800}"
COMMAND_TIMEOUT_SECONDS="${DEMO_COMMAND_TIMEOUT_SECONDS:-1800}"
QUERY_TIMEOUT_SECONDS="${DEMO_QUERY_TIMEOUT_SECONDS:-60}"

require_value "$CARDANO_COSMOS_CHANNEL_ID" "CARDANO_COSMOS_CHANNEL_ID is required."
require_value "$COSMOS_CARDANO_CHANNEL_ID" "COSMOS_CARDANO_CHANNEL_ID is required."
[[ -f "$HANDLER_JSON" ]] || {
  echo "Could not find Cardano handler deployment at $HANDLER_JSON." >&2
  exit 1
}

CARDANO_SEND_DENOM="$(jq -r '.tokens.mock // empty' "$HANDLER_JSON" | head -n 1)"
require_value "$CARDANO_SEND_DENOM" "Could not resolve the Cardano mock token denom from handler.json."

key_output="$("$HERMES_BIN" keys list --chain "$COSMOS_CHAIN_ID" 2>&1)" || {
  printf '%s\n' "$key_output" >&2
  exit 1
}
COSMOS_RELAYER_KEY_NAME="${COSMOS_CHAIN_ID}-relayer"
matching_key_output="$(printf '%s\n' "$key_output" | awk -v key="$COSMOS_RELAYER_KEY_NAME" 'index($0, key) { print }')"
cosmos_receivers="$(printf '%s\n' "$matching_key_output" | sed -nE 's/.*(cosmos1[0-9a-z]{38}).*/\1/p' | sort -u)"
cosmos_receiver_count="$(printf '%s\n' "$cosmos_receivers" | sed '/^$/d' | wc -l | tr -d ' ')"
if (( cosmos_receiver_count != 1 )); then
  echo "Expected one funded address for Hermes key ${COSMOS_RELAYER_KEY_NAME}." >&2
  exit 1
fi
COSMOS_RECEIVER="$cosmos_receivers"

baseline_cardano_state="$(wait_for_stable_commitment_state "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID")"
baseline_cosmos_state="$(wait_for_stable_commitment_state "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID")"
BASELINE_CARDANO_SEQUENCES="$(jq -c '.seqs' <<<"$baseline_cardano_state")"
BASELINE_COSMOS_SEQUENCES="$(jq -c '.seqs' <<<"$baseline_cosmos_state")"

echo "Submitting Cardano -> ${COSMOS_PROFILE} Classic transfer..."
forward_transfer="$(submit_transfer \
  "$CARDANO_CHAIN_ID" \
  "$COSMOS_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$CARDANO_SEND_AMOUNT" \
  "$CARDANO_SEND_DENOM" \
  "$COSMOS_RECEIVER")"
forward_sequence="$(jq -r '.sequence' <<<"$forward_transfer")"
forward_commitment="$(wait_for_commitment \
  "$CARDANO_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$forward_sequence")"
forward_proof_height="$(jq -r '.height.revision_height' <<<"$forward_commitment")"

catch_up_cardano_client "$forward_proof_height"
relay_receive \
  "$CARDANO_CHAIN_ID" \
  "$COSMOS_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$forward_sequence"
wait_for_acknowledgement_proof \
  "$COSMOS_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$forward_sequence" >/dev/null
relay_acknowledgement \
  "$COSMOS_CHAIN_ID" \
  "$CARDANO_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$forward_sequence"
wait_for_commitment_absent \
  "$CARDANO_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$forward_sequence"

echo "Submitting ${COSMOS_PROFILE} -> Cardano Classic return transfer..."
return_transfer="$(submit_transfer \
  "$COSMOS_CHAIN_ID" \
  "$CARDANO_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$COSMOS_RETURN_AMOUNT" \
  "$COSMOS_RETURN_DENOM" \
  "$CARDANO_RECEIVER")"
return_sequence="$(jq -r '.sequence' <<<"$return_transfer")"
wait_for_commitment \
  "$COSMOS_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$return_sequence" >/dev/null

relay_receive \
  "$COSMOS_CHAIN_ID" \
  "$CARDANO_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$return_sequence"
return_ack="$(wait_for_acknowledgement_proof \
  "$CARDANO_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$return_sequence")"
return_ack_height="$(jq -r '.height.revision_height' <<<"$return_ack")"

catch_up_cardano_client "$return_ack_height"
relay_acknowledgement \
  "$CARDANO_CHAIN_ID" \
  "$COSMOS_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$return_sequence"
wait_for_commitment_absent \
  "$COSMOS_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$return_sequence"

assert_commitments_match \
  "$CARDANO_CHAIN_ID" \
  "$CARDANO_COSMOS_CHANNEL_ID" \
  "$BASELINE_CARDANO_SEQUENCES"
assert_commitments_match \
  "$COSMOS_CHAIN_ID" \
  "$COSMOS_CARDANO_CHANNEL_ID" \
  "$BASELINE_COSMOS_SEQUENCES"

echo "Direct Cardano-to-${COSMOS_PROFILE} Classic compatibility demo completed."
