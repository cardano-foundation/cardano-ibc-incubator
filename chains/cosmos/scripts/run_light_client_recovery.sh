#!/usr/bin/env bash

set -Eeuo pipefail

fail() {
  echo "$*" >&2
  exit 1
}

require_value() {
  [[ -n "$1" ]] || fail "$2"
}

require_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || fail "$2 must be a positive integer."
}

require_nonnegative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]] || fail "$2 must be a non-negative integer."
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  # Give the command its own process group so timeout cleanup reaches shell
  # wrappers and every host-side descendant, not only the immediate child.
  local monitor_was_enabled=false
  if [[ "$-" == *m* ]]; then
    monitor_was_enabled=true
  else
    set -m
  fi
  "$@" &
  local command_pid=$!
  if [[ "$monitor_was_enabled" == "false" ]]; then
    set +m
  fi
  local started_at=$SECONDS
  local timed_out=false

  while kill -0 "$command_pid" 2>/dev/null; do
    if (( SECONDS - started_at >= timeout_seconds )); then
      timed_out=true
      kill -TERM -- "-$command_pid" 2>/dev/null ||
        kill -TERM "$command_pid" 2>/dev/null || true
      local grace_started_at=$SECONDS
      while kill -0 "$command_pid" 2>/dev/null &&
        (( SECONDS - grace_started_at < 5 )); do
        sleep 0.05
      done
      if kill -0 "$command_pid" 2>/dev/null; then
        kill -KILL -- "-$command_pid" 2>/dev/null ||
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
    return 124
  fi
  return "$status"
}

# Hermes may emit JSON log records before its one status envelope. Only the
# final status envelope is authoritative; a failed process or envelope is fatal.
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

  if (( status != 0 )) || [[ -z "$envelope" ]] ||
    ! jq -e '.status == "success"' >/dev/null <<<"$envelope"; then
    if [[ "$output_mode" == "retryable" ]] && {
      [[ "$output" == *"HEIGHT_NOT_ACCEPTED"* ]] ||
        [[ "$output" == *"stability thresholds not met"* ]] ||
        [[ "$output" == *"already up-to-date"* ]] ||
        [[ "$output" == *"already at or above target height"* ]] ||
        [[ "$output" == *"lower than (or equal to) client latest height"* ]] ||
        [[ "$output" == *"packet has not timed out"* ]] ||
        [[ "$output" == *"packet has not yet timed out"* ]] ||
        [[ "$output" == *"packet timeout has not been reached"* ]] ||
        [[ "$output" == *"timeout height not reached"* ]];
    }; then
      return 75
    fi
    if [[ "$output_mode" != "quiet" ]]; then
      printf '%s\n' "$output" >&2
    fi
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

run_simd_with_timeout() {
  local timeout_seconds="$1"
  shift

  if [[ -n "${SIMD_BIN:-}" ]]; then
    run_with_timeout "$timeout_seconds" "$SIMD_BIN" "$@"
  else
    # The host-side Docker CLI is not the parent of the exec process inside the
    # container. Apply the same deadline there so a timed-out transaction
    # cannot continue and broadcast after the harness has failed.
    run_with_timeout "$((timeout_seconds + 6))" \
      "$DOCKER_BIN" compose \
      -f "$COSMOS_COMPOSE_FILE" \
      --profile "$COSMOS_PROFILE" \
      exec -T "$COSMOS_PROFILE" \
      timeout -s TERM -k 5 "$timeout_seconds" simd "$@"
  fi
}

simd_json() {
  local timeout_seconds="$1"
  local output_mode="$2"
  shift 2

  local output stderr_output
  local stderr_file
  stderr_file="$(mktemp "${TMPDIR:-/tmp}/caribic-simd-stderr.XXXXXX")" || return $?
  local status=0
  if output="$(run_simd_with_timeout "$timeout_seconds" "$@" 2>"$stderr_file")"; then
    status=0
  else
    status=$?
  fi
  stderr_output="$(<"$stderr_file")"
  rm -f -- "$stderr_file"

  if (( status != 0 )); then
    if [[ "$output_mode" != "quiet" ]]; then
      [[ -z "$stderr_output" ]] || printf '%s\n' "$stderr_output" >&2
      printf '%s\n' "$output" >&2
    fi
    return "$status"
  fi

  local json=""
  if json="$(printf '%s\n' "$output" | jq -ce 'if type == "object" then . else error("expected a JSON object") end' 2>/dev/null)"; then
    :
  else
    if [[ "$output_mode" != "quiet" ]]; then
      echo "simd did not return exactly one JSON object:" >&2
      [[ -z "$stderr_output" ]] || printf '%s\n' "$stderr_output" >&2
      printf '%s\n' "$output" >&2
    fi
    return 1
  fi

  if [[ "$output_mode" == "show" ]]; then
    [[ -z "$stderr_output" ]] || printf '%s\n' "$stderr_output" >&2
    printf '%s\n' "$output" >&2
  fi
  printf '%s\n' "$json"
}

simd_query() {
  local output_mode="$1"
  shift
  simd_json "$QUERY_TIMEOUT_SECONDS" "$output_mode" \
    query "$@" \
    --home "$SIMD_HOME" \
    --node "$SIMD_NODE" \
    --output json
}

simd_broadcast_tx() {
  local output
  output="$(simd_json "$COMMAND_TIMEOUT_SECONDS" show \
    tx "$@" \
    --from validator \
    --keyring-backend test \
    --home "$SIMD_HOME" \
    --chain-id "$COSMOS_CHAIN_ID" \
    --node "$SIMD_NODE" \
    --gas auto \
    --gas-adjustment 1.5 \
    --gas-prices 0.0025stake \
    --broadcast-mode sync \
    --output json \
    --yes)" || return $?

  jq -e '
    type == "object"
      and ((.code | tonumber) == 0)
      and (.txhash | type == "string")
      and (.txhash | test("^[0-9A-Fa-f]{64}$"))
  ' >/dev/null <<<"$output" || {
    echo "simd transaction broadcast failed or returned an invalid response:" >&2
    printf '%s\n' "$output" >&2
    return 1
  }
  jq -r '.txhash' <<<"$output"
}

wait_for_tx() {
  local tx_hash="$1"
  local deadline=$(( $(date +%s) + TX_COMMIT_TIMEOUT_SECONDS ))

  while true; do
    local tx=""
    if tx="$(simd_query quiet tx "$tx_hash")"; then
      if ! jq -e '(.code | tonumber) == 0' >/dev/null <<<"$tx"; then
        echo "Committed transaction ${tx_hash} failed:" >&2
        printf '%s\n' "$tx" >&2
        return 1
      fi
      printf '%s\n' "$tx"
      return 0
    fi

    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for transaction ${tx_hash} to commit." >&2
      simd_query show tx "$tx_hash" >/dev/null || true
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

client_status() {
  local client_id="$1"
  local result
  result="$(simd_query quiet ibc client status "$client_id")" || return $?
  jq -er '
    if type == "object" and (.status | type) == "string" and (.status | length) > 0
    then .status
    else error("invalid client status response")
    end
  ' <<<"$result"
}

query_client_state() {
  local client_id="$1"
  local result
  result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query client state \
    --chain "$COSMOS_CHAIN_ID" \
    --client "$client_id")" || return $?
  jq -ce '
    if type == "object"
      and (.latest_height.revision_height | type) == "number"
      and (.latest_checkpoint_height.revision_height | type) == "number"
      and (.trusting_period | type) == "object"
      and (.trusting_period.secs | type) == "number"
      and (.trusting_period.nanos | type) == "number"
    then .
    else error("invalid probabilistic client state")
    end
  ' <<<"$result"
}

client_latest_height() {
  jq -er '.latest_height.revision_height' <<<"$1"
}

client_checkpoint_height() {
  jq -er '.latest_checkpoint_height.revision_height' <<<"$1"
}

client_trusting_period_seconds() {
  jq -er '
    if (.trusting_period.secs | type) == "number"
      and (.trusting_period.nanos | type) == "number"
      and .trusting_period.nanos == 0
    then .trusting_period.secs
    else error("client trusting period is not an integral number of seconds")
    end
  ' <<<"$1"
}

client_recovery_invariants() {
  jq -cS '{
    upgrade_path,
    host_state_nft_policy_id,
    host_state_nft_token_name,
    system_start_unix_ns,
    slot_length_ns,
    slots_per_kes_period,
    max_kes_evolutions
  }' <<<"$1"
}

client_recovered_projection() {
  jq -cS '{
    chain_id,
    latest_height,
    current_epoch,
    trusting_period,
    epoch_stake_distribution,
    epoch_nonce,
    current_epoch_start_slot,
    current_epoch_end_slot_exclusive,
    epoch_contexts,
    latest_checkpoint_height,
    latest_checkpoint_block_hash,
    latest_checkpoint_epoch,
    max_kes_evolutions,
    latest_checkpoint_operational_certificate_counters
  }' <<<"$1"
}

query_route_snapshot() {
  local channel
  channel="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query channel end \
    --chain "$COSMOS_CHAIN_ID" \
    --port transfer \
    --channel "$COSMOS_CARDANO_CHANNEL_ID")" || return $?

  local connection
  connection="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query connection end \
    --chain "$COSMOS_CHAIN_ID" \
    --connection "$CONNECTION_ID")" || return $?

  jq -cnS --argjson channel "$channel" --argjson connection "$connection" \
    '{channel: $channel, connection: $connection}'
}

discover_connection_id() {
  local channel
  channel="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query channel end \
    --chain "$COSMOS_CHAIN_ID" \
    --port transfer \
    --channel "$COSMOS_CARDANO_CHANNEL_ID")" || return $?
  jq -er '
    if type == "object"
      and (.connection_hops | type) == "array"
      and (.connection_hops | length) == 1
      and (.connection_hops[0] | type) == "string"
      and (.connection_hops[0] | test("^connection-[0-9]+$"))
    then .connection_hops[0]
    else error("expected exactly one valid connection hop")
    end
  ' <<<"$channel"
}

discover_subject_client_id() {
  local connection
  connection="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query connection end \
    --chain "$COSMOS_CHAIN_ID" \
    --connection "$CONNECTION_ID")" || return $?
  jq -er '
    if type == "object"
      and (.client_id | type) == "string"
      and (.client_id | test("^08-cardano-probabilistic-[0-9]+$"))
    then .client_id
    else error("connection does not use a probabilistic Cardano client")
    end
  ' <<<"$connection"
}

query_cardano_client_ids() {
  local result
  result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query clients \
    --host-chain "$COSMOS_CHAIN_ID" \
    --reference-chain "$CARDANO_CHAIN_ID")" || return $?
  jq -ce '
    if type == "array"
      and all(.[]; type == "string" and test("^08-cardano-probabilistic-[0-9]+$"))
    then .
    else error("invalid Cardano client list")
    end
  ' <<<"$result"
}

create_substitute_client() {
  local result
  result="$(hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show create client \
    --host-chain "$COSMOS_CHAIN_ID" \
    --reference-chain "$CARDANO_CHAIN_ID")" || return $?
  jq -er '
    if type == "object"
      and (.CreateClient | type) == "object"
      and (.CreateClient.client_id | type) == "string"
      and (.CreateClient.client_id | test("^08-cardano-probabilistic-[0-9]+$"))
    then .CreateClient.client_id
    else error("create client did not emit one structured CreateClient event")
    end
  ' <<<"$result"
}

wait_for_subject_expiry() {
  local deadline=$(( $(date +%s) + EXPIRY_TIMEOUT_SECONDS ))

  while true; do
    local subject_status
    subject_status="$(client_status "$SUBJECT_CLIENT_ID")" || {
      echo "Could not query subject client status." >&2
      return 1
    }
    local substitute_status
    substitute_status="$(client_status "$SUBSTITUTE_CLIENT_ID")" || {
      echo "Could not query substitute client status." >&2
      return 1
    }

    [[ "$substitute_status" == "Active" ]] || {
      echo "Substitute client became ${substitute_status} while waiting for subject expiry." >&2
      return 1
    }
    if [[ "$subject_status" == "Expired" ]]; then
      return 0
    fi
    [[ "$subject_status" == "Active" ]] || {
      echo "Subject client became ${subject_status}; expected a genuine expiry." >&2
      return 1
    }

    if (( $(date +%s) >= deadline )); then
      echo "Subject client did not expire within ${EXPIRY_TIMEOUT_SECONDS}s." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_substitute_newer() {
  local subject_latest="$1"
  local subject_checkpoint="$2"
  local deadline=$(( $(date +%s) + SUBSTITUTE_UPDATE_TIMEOUT_SECONDS ))

  while true; do
    [[ "$(client_status "$SUBJECT_CLIENT_ID")" == "Active" ]] || {
      echo "Subject expired before the substitute became strictly newer." >&2
      return 1
    }
    [[ "$(client_status "$SUBSTITUTE_CLIENT_ID")" == "Active" ]] || {
      echo "Substitute is not Active while advancing it for recovery." >&2
      return 1
    }

    local state
    state="$(query_client_state "$SUBSTITUTE_CLIENT_ID")" || return $?
    local latest checkpoint
    latest="$(client_latest_height "$state")"
    checkpoint="$(client_checkpoint_height "$state")"
    if (( latest > subject_latest && checkpoint > subject_checkpoint )); then
      printf '%s\n' "$state"
      return 0
    fi

    if (( $(date +%s) >= deadline )); then
      echo "Substitute did not advance beyond subject latest/checkpoint ${subject_latest}/${subject_checkpoint}." >&2
      return 1
    fi

    # Only the substitute is updated here. Failures caused by a not-yet-stable
    # Cardano root are retried, while the state/status checks remain fail-closed.
    local update_status=0
    if hermes_json_result "$COMMAND_TIMEOUT_SECONDS" retryable update client \
      --host-chain "$COSMOS_CHAIN_ID" \
      --client "$SUBSTITUTE_CLIENT_ID" >/dev/null; then
      update_status=0
    else
      update_status=$?
    fi
    if (( update_status != 0 && update_status != 75 )); then
      return "$update_status"
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

proposal_id_from_tx() {
  jq -er '
    [
      (.events[]? | select(.type == "submit_proposal") | .attributes[]?
        | select(.key == "proposal_id") | .value),
      (.logs[]?.events[]? | select(.type == "submit_proposal") | .attributes[]?
        | select(.key == "proposal_id") | .value)
    ]
    | map(select(type == "string" and test("^[1-9][0-9]*$")))
    | unique
    | if length == 1 then .[0] else error("expected one submit_proposal proposal_id") end
  ' <<<"$1"
}

submit_recovery_proposal() {
  local tx_hash
  tx_hash="$(simd_broadcast_tx ibc client recover-client \
    "$SUBJECT_CLIENT_ID" \
    "$SUBSTITUTE_CLIENT_ID" \
    --title "Recover Cardano client" \
    --summary "Local end-to-end recovery of an expired Cardano client" \
    --deposit 10000000stake)" || return $?
  local tx
  tx="$(wait_for_tx "$tx_hash")" || return $?
  proposal_id_from_tx "$tx"
}

vote_for_recovery() {
  local proposal_id="$1"
  local tx_hash
  tx_hash="$(simd_broadcast_tx gov vote "$proposal_id" yes)" || return $?
  wait_for_tx "$tx_hash" >/dev/null
}

wait_for_proposal_passed() {
  local proposal_id="$1"
  local deadline=$(( $(date +%s) + GOVERNANCE_TIMEOUT_SECONDS ))

  while true; do
    local result
    result="$(simd_query quiet gov proposal "$proposal_id")" || {
      echo "Could not query governance proposal ${proposal_id}." >&2
      return 1
    }
    local status
    status="$(jq -er '
      if type == "object" and (.proposal | type) == "object"
        and (.proposal.status | type) == "string"
      then .proposal.status
      else error("invalid governance proposal response")
      end
    ' <<<"$result")" || return $?

    case "$status" in
      PROPOSAL_STATUS_PASSED)
        return 0
        ;;
      PROPOSAL_STATUS_REJECTED|PROPOSAL_STATUS_FAILED)
        local failed_reason
        failed_reason="$(jq -r '.proposal.failed_reason // ""' <<<"$result")"
        echo "Recovery proposal ${proposal_id} ended as ${status}: ${failed_reason}" >&2
        return 1
        ;;
      PROPOSAL_STATUS_DEPOSIT_PERIOD|PROPOSAL_STATUS_VOTING_PERIOD)
        ;;
      *)
        echo "Recovery proposal ${proposal_id} has unexpected status ${status}." >&2
        return 1
        ;;
    esac

    if (( $(date +%s) >= deadline )); then
      echo "Recovery proposal ${proposal_id} did not pass within ${GOVERNANCE_TIMEOUT_SECONDS}s." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

query_cosmos_commitments() {
  local result
  result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" quiet query packet commitments \
    --chain "$COSMOS_CHAIN_ID" \
    --port transfer \
    --channel "$COSMOS_CARDANO_CHANNEL_ID")" || return $?
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

query_commitment_sequences() {
  local chain_id="$1"
  local channel_id="$2"
  local output_mode="quiet"
  if [[ "$chain_id" == "$CARDANO_CHAIN_ID" ]]; then
    output_mode="retryable"
  fi
  local result
  result="$(hermes_json_result "$QUERY_TIMEOUT_SECONDS" "$output_mode" query packet commitments \
    --chain "$chain_id" \
    --port transfer \
    --channel "$channel_id")" || return $?
  jq -ce '
    if type == "object"
      and (.height.revision_height | type) == "number"
      and (.seqs | type) == "array"
      and all(.seqs[]; type == "number")
    then .seqs
    else error("invalid packet commitment response")
    end
  ' <<<"$result"
}

wait_for_commitment_sequences() {
  local chain_id="$1"
  local channel_id="$2"
  local deadline=$(( $(date +%s) + PACKET_TIMEOUT_SECONDS ))

  while true; do
    local sequences
    local query_status=0
    if sequences="$(query_commitment_sequences "$chain_id" "$channel_id")"; then
      printf '%s\n' "$sequences"
      return 0
    else
      query_status=$?
    fi
    if (( query_status != 75 )); then
      return "$query_status"
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Could not obtain packet commitments for ${chain_id}/${channel_id}." >&2
      hermes_json_result "$QUERY_TIMEOUT_SECONDS" show query packet commitments \
        --chain "$chain_id" \
        --port transfer \
        --channel "$channel_id" >/dev/null || true
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

query_channel_sequences() {
  local send_result receive_result
  send_result="$(simd_query quiet ibc channel next-sequence-send \
    transfer "$COSMOS_CARDANO_CHANNEL_ID")" || return $?
  receive_result="$(simd_query quiet ibc channel next-sequence-receive \
    transfer "$COSMOS_CARDANO_CHANNEL_ID")" || return $?
  jq -cnS --argjson send "$send_result" --argjson receive "$receive_result" '
    def sequence($value):
      if ($value | type) == "number" then $value
      elif ($value | type) == "string" and ($value | test("^[0-9]+$"))
      then ($value | tonumber)
      else error("invalid channel sequence")
      end;
    {
      next_sequence_send: sequence($send.next_sequence_send),
      next_sequence_receive: sequence($receive.next_sequence_receive)
    }
  '
}

query_cosmos_relayer_address() {
  local result
  result="$(simd_json "$QUERY_TIMEOUT_SECONDS" quiet keys show relayer \
    --keyring-backend test \
    --home "$SIMD_HOME" \
    --output json)" || return $?
  jq -er '
    if type == "object"
      and (.address | type) == "string"
      and (.address | test("^cosmos1[0-9a-z]{38}$"))
    then .address
    else error("invalid Cosmos relayer key response")
    end
  ' <<<"$result"
}

query_voucher_snapshot() {
  local address="$1"
  local result
  result="$(simd_query quiet bank balances "$address")" || return $?
  jq -ce '
    if type != "object" or (.balances | type) != "array" then
      error("invalid bank balance response")
    else
      [.balances[]
        | select((.denom | type) == "string" and (.denom | test("^ibc/[0-9A-F]{64}$")))
        | select((.amount | type) == "string" and (.amount | test("^[0-9]+$")))]
      | if length == 1 then .[0] else error("expected exactly one Cosmos IBC voucher balance") end
    end
  ' <<<"$result"
}

query_voucher_trace() {
  local ibc_denom="$1"
  local hash="${ibc_denom#ibc/}"
  [[ "$ibc_denom" == "ibc/${hash}" && "$hash" =~ ^[0-9A-F]{64}$ ]] || {
    echo "Invalid IBC voucher denomination ${ibc_denom}." >&2
    return 1
  }

  local result
  case "$COSMOS_PROFILE" in
    v8-classic)
      result="$(simd_query quiet ibc-transfer denom-trace "$hash")" || return $?
      jq -ce --arg path "transfer/${COSMOS_CARDANO_CHANNEL_ID}" --arg base "$CARDANO_SEND_DENOM" '
        if type == "object"
          and (.denom_trace | type) == "object"
          and .denom_trace.path == $path
          and .denom_trace.base_denom == $base
        then .
        else error("unexpected v8 denomination trace")
        end
      ' <<<"$result"
      ;;
    v10-classic)
      result="$(simd_query quiet ibc-transfer denom "$hash")" || return $?
      jq -ce --arg channel "$COSMOS_CARDANO_CHANNEL_ID" --arg base "$CARDANO_SEND_DENOM" '
        if type == "object"
          and (.denom | type) == "object"
          and .denom.base == $base
          and (.denom.trace | type) == "array"
          and (.denom.trace | length) == 1
          and .denom.trace[0].port_id == "transfer"
          and .denom.trace[0].channel_id == $channel
        then .
        else error("unexpected v10 denomination trace")
        end
      ' <<<"$result"
      ;;
    *)
      echo "Unsupported Cosmos profile for denomination query: ${COSMOS_PROFILE}." >&2
      return 1
      ;;
  esac
}

query_escrow_address() {
  local output
  output="$(run_simd_with_timeout "$QUERY_TIMEOUT_SECONDS" \
    query ibc-transfer escrow-address transfer "$COSMOS_CARDANO_CHANNEL_ID" \
    --home "$SIMD_HOME" \
    --node "$SIMD_NODE")" || return $?
  [[ "$output" =~ ^cosmos1[0-9a-z]{38}$ ]] || {
    echo "Invalid escrow address response: ${output}" >&2
    return 1
  }
  printf '%s\n' "$output"
}

query_bank_balance() {
  local address="$1"
  local denom="$2"
  local result
  result="$(simd_query quiet bank balance "$address" "$denom")" || return $?
  jq -ce --arg denom "$denom" '
    if type == "object"
      and (.balance | type) == "object"
      and .balance.denom == $denom
      and (.balance.amount | type) == "string"
      and (.balance.amount | test("^(0|[1-9][0-9]*)$"))
    then .balance
    else error("invalid bank balance response")
    end
  ' <<<"$result"
}

submit_timeout_transfer() {
  local result
  result="$(hermes_json_result "$COMMAND_TIMEOUT_SECONDS" show tx ft-transfer \
    --src-chain "$COSMOS_CHAIN_ID" \
    --dst-chain "$CARDANO_CHAIN_ID" \
    --src-port transfer \
    --src-channel "$COSMOS_CARDANO_CHANNEL_ID" \
    --amount 1 \
    --denom utest \
    --receiver "$CARDANO_RECEIVER" \
    --timeout-seconds "$NONMEMBERSHIP_TIMEOUT_SECONDS")" || return $?
  jq -er '
    [.[] | select(.event.SendPacket != null) | .event.SendPacket.packet.sequence]
    | if length == 1 and (.[0] | type) == "number"
      then .[0]
      else error("timeout fixture did not emit exactly one SendPacket event")
      end
  ' <<<"$result"
}

wait_for_commitment_membership() {
  local sequence="$1"
  local deadline=$(( $(date +%s) + PACKET_TIMEOUT_SECONDS ))

  while true; do
    local state
    state="$(query_cosmos_commitments)" || return $?
    if jq -e --argjson sequence "$sequence" '.seqs | index($sequence) != null' >/dev/null <<<"$state"; then
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for Cosmos packet commitment ${sequence}." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_timeout_with_nonmembership_proof() {
  local sequence="$1"
  local deadline=$(( $(date +%s) + PACKET_TIMEOUT_SECONDS ))

  while true; do
    local result=""
    local relay_status=0
    if result="$(hermes_json_result "$COMMAND_TIMEOUT_SECONDS" retryable tx packet-recv \
      --src-chain "$COSMOS_CHAIN_ID" \
      --dst-chain "$CARDANO_CHAIN_ID" \
      --src-port transfer \
      --src-channel "$COSMOS_CARDANO_CHANNEL_ID" \
      --packet-sequences "$sequence")"; then
      if jq -e --argjson sequence "$sequence" '
        type == "array"
          and any(.[]; .TimeoutPacket.packet.sequence == $sequence)
          and all(.[]; .WriteAcknowledgement == null)
      ' >/dev/null <<<"$result"; then
        return 0
      fi
      if jq -e --argjson sequence "$sequence" '
        type == "array" and any(.[]; .WriteAcknowledgement.packet.sequence == $sequence)
      ' >/dev/null <<<"$result"; then
        echo "Packet ${sequence} was received instead of timing out; non-membership was not exercised." >&2
        return 1
      fi
    else
      relay_status=$?
      if (( relay_status != 75 )); then
        return "$relay_status"
      fi
    fi

    local state
    state="$(query_cosmos_commitments)" || return $?
    if ! jq -e --argjson sequence "$sequence" '.seqs | index($sequence) != null' >/dev/null <<<"$state"; then
      echo "Packet ${sequence} commitment disappeared without a structured TimeoutPacket result." >&2
      return 1
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Timed out waiting for a proof-ready TimeoutPacket for sequence ${sequence}." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_commitment_baseline() {
  local expected="$1"
  local deadline=$(( $(date +%s) + PACKET_TIMEOUT_SECONDS ))

  while true; do
    local state
    state="$(query_cosmos_commitments)" || return $?
    if jq -e --argjson expected "$expected" '.seqs == $expected' >/dev/null <<<"$state"; then
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "Timed-out packet commitment did not return to its baseline." >&2
      return 1
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

run_forward_token_transfer() {
  CARIBIC_PROJECT_ROOT="$repo_root" \
    HERMES_BIN="$HERMES_BIN" \
    COSMOS_PROFILE="$COSMOS_PROFILE" \
    CARDANO_CHAIN_ID="$CARDANO_CHAIN_ID" \
    COSMOS_CHAIN_ID="$COSMOS_CHAIN_ID" \
    CARDANO_COSMOS_CHANNEL_ID="$CARDANO_COSMOS_CHANNEL_ID" \
    COSMOS_CARDANO_CHANNEL_ID="$COSMOS_CARDANO_CHANNEL_ID" \
    CARDANO_CLIENT_ID="$SUBJECT_CLIENT_ID" \
    CARDANO_SEND_DENOM="$CARDANO_SEND_DENOM" \
    CARIBIC_TOKEN_SWAP_AMOUNT="$RECOVERY_TRANSFER_AMOUNT" \
    COSMOS_DEMO_DIRECTION="cardano-to-cosmos" \
    bash "$DIRECT_TOKEN_SWAP_SCRIPT"
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="${CARIBIC_PROJECT_ROOT:-$(cd "$script_dir/../../.." && pwd -P)}"
HERMES_BIN="${HERMES_BIN:-$repo_root/relayer/target/release/hermes}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
COSMOS_COMPOSE_FILE="${COSMOS_COMPOSE_FILE:-$repo_root/chains/cosmos/docker-compose.yml}"
DIRECT_TOKEN_SWAP_SCRIPT="${DIRECT_TOKEN_SWAP_SCRIPT:-$script_dir/run_direct_token_swap.sh}"
HANDLER_JSON="${HANDLER_JSON:-$repo_root/cardano/offchain/deployments/handler.json}"

COSMOS_PROFILE="${COSMOS_PROFILE:-v8-classic}"
CARDANO_CHAIN_ID="${CARDANO_CHAIN_ID:-cardano-devnet}"
COSMOS_CHAIN_ID="${COSMOS_CHAIN_ID:-v8-classic-1}"
CARDANO_COSMOS_CHANNEL_ID="${CARDANO_COSMOS_CHANNEL_ID:-}"
COSMOS_CARDANO_CHANNEL_ID="${COSMOS_CARDANO_CHANNEL_ID:-}"
SUBJECT_TRUSTING_PERIOD_SECONDS="${SUBJECT_TRUSTING_PERIOD_SECONDS:-300}"
CARDANO_RECEIVER="${CARDANO_RECEIVER:-247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8}"
RECOVERY_TRANSFER_AMOUNT="${RECOVERY_TRANSFER_AMOUNT:-12345}"
CARDANO_SEND_DENOM="${CARDANO_SEND_DENOM:-}"

SIMD_HOME="${SIMD_HOME:-/var/lib/simd}"
SIMD_NODE="${SIMD_NODE:-tcp://127.0.0.1:26657}"
POLL_INTERVAL_SECONDS="${RECOVERY_POLL_INTERVAL_SECONDS:-2}"
QUERY_TIMEOUT_SECONDS="${RECOVERY_QUERY_TIMEOUT_SECONDS:-60}"
COMMAND_TIMEOUT_SECONDS="${RECOVERY_COMMAND_TIMEOUT_SECONDS:-1800}"
TX_COMMIT_TIMEOUT_SECONDS="${RECOVERY_TX_COMMIT_TIMEOUT_SECONDS:-60}"
EXPIRY_TIMEOUT_SECONDS="${RECOVERY_EXPIRY_TIMEOUT_SECONDS:-$((SUBJECT_TRUSTING_PERIOD_SECONDS + 180))}"
GOVERNANCE_TIMEOUT_SECONDS="${RECOVERY_GOVERNANCE_TIMEOUT_SECONDS:-180}"
SUBSTITUTE_UPDATE_TIMEOUT_SECONDS="${RECOVERY_SUBSTITUTE_UPDATE_TIMEOUT_SECONDS:-180}"
NONMEMBERSHIP_TIMEOUT_SECONDS="${RECOVERY_NONMEMBERSHIP_TIMEOUT_SECONDS:-5}"
PACKET_TIMEOUT_SECONDS="${RECOVERY_PACKET_TIMEOUT_SECONDS:-600}"

require_value "$CARDANO_COSMOS_CHANNEL_ID" "CARDANO_COSMOS_CHANNEL_ID is required."
require_value "$COSMOS_CARDANO_CHANNEL_ID" "COSMOS_CARDANO_CHANNEL_ID is required."
require_positive_integer "$SUBJECT_TRUSTING_PERIOD_SECONDS" "SUBJECT_TRUSTING_PERIOD_SECONDS"
require_positive_integer "$RECOVERY_TRANSFER_AMOUNT" "RECOVERY_TRANSFER_AMOUNT"
require_nonnegative_integer "$POLL_INTERVAL_SECONDS" "RECOVERY_POLL_INTERVAL_SECONDS"
require_positive_integer "$QUERY_TIMEOUT_SECONDS" "RECOVERY_QUERY_TIMEOUT_SECONDS"
require_positive_integer "$COMMAND_TIMEOUT_SECONDS" "RECOVERY_COMMAND_TIMEOUT_SECONDS"
require_positive_integer "$TX_COMMIT_TIMEOUT_SECONDS" "RECOVERY_TX_COMMIT_TIMEOUT_SECONDS"
require_positive_integer "$EXPIRY_TIMEOUT_SECONDS" "RECOVERY_EXPIRY_TIMEOUT_SECONDS"
require_positive_integer "$GOVERNANCE_TIMEOUT_SECONDS" "RECOVERY_GOVERNANCE_TIMEOUT_SECONDS"
require_positive_integer "$SUBSTITUTE_UPDATE_TIMEOUT_SECONDS" "RECOVERY_SUBSTITUTE_UPDATE_TIMEOUT_SECONDS"
require_positive_integer "$NONMEMBERSHIP_TIMEOUT_SECONDS" "RECOVERY_NONMEMBERSHIP_TIMEOUT_SECONDS"
require_positive_integer "$PACKET_TIMEOUT_SECONDS" "RECOVERY_PACKET_TIMEOUT_SECONDS"

[[ -x "$HERMES_BIN" ]] || fail "Local Hermes binary not found at $HERMES_BIN."
[[ -f "$DIRECT_TOKEN_SWAP_SCRIPT" ]] || fail "Direct token-swap script not found at $DIRECT_TOKEN_SWAP_SCRIPT."
if [[ -z "$CARDANO_SEND_DENOM" ]]; then
  [[ -f "$HANDLER_JSON" ]] || fail "Cardano handler deployment not found at $HANDLER_JSON."
  CARDANO_SEND_DENOM="$(jq -er '.tokens.mock | select(type == "string" and length > 0)' "$HANDLER_JSON")" ||
    fail "Could not resolve the Cardano mock token denomination from $HANDLER_JSON."
fi
if [[ -z "${SIMD_BIN:-}" ]]; then
  command -v "$DOCKER_BIN" >/dev/null 2>&1 || fail "Docker executable '$DOCKER_BIN' was not found."
  [[ -f "$COSMOS_COMPOSE_FILE" ]] || fail "Cosmos compose file not found at $COSMOS_COMPOSE_FILE."
else
  [[ -x "$SIMD_BIN" ]] || fail "SIMD_BIN is not executable: $SIMD_BIN"
fi

CONNECTION_ID="$(discover_connection_id)"
SUBJECT_CLIENT_ID="$(discover_subject_client_id)"
initial_client_ids="$(query_cardano_client_ids)"
jq -e --arg subject "$SUBJECT_CLIENT_ID" \
  'length == 1 and .[0] == $subject' >/dev/null <<<"$initial_client_ids" ||
  fail "Expected the fresh route's subject to be the only Cardano client on ${COSMOS_CHAIN_ID}."

subject_state="$(query_client_state "$SUBJECT_CLIENT_ID")"
subject_trusting_period="$(client_trusting_period_seconds "$subject_state")"
[[ "$subject_trusting_period" == "$SUBJECT_TRUSTING_PERIOD_SECONDS" ]] ||
  fail "Subject ${SUBJECT_CLIENT_ID} has ${subject_trusting_period}s trusting period; expected ${SUBJECT_TRUSTING_PERIOD_SECONDS}s."
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == "Active" ]] ||
  fail "Subject client is not Active before the recovery scenario."

subject_invariants="$(client_recovery_invariants "$subject_state")"
route_initial="$(query_route_snapshot)"

echo "Creating a long-lived substitute for ${SUBJECT_CLIENT_ID}..."
SUBSTITUTE_CLIENT_ID="$(create_substitute_client)"
[[ "$SUBSTITUTE_CLIENT_ID" != "$SUBJECT_CLIENT_ID" ]] ||
  fail "Hermes returned the subject identifier as its own substitute."

all_client_ids="$(query_cardano_client_ids)"
jq -e --arg subject "$SUBJECT_CLIENT_ID" --arg substitute "$SUBSTITUTE_CLIENT_ID" '
  length == 2
    and (index($subject) != null)
    and (index($substitute) != null)
' >/dev/null <<<"$all_client_ids" ||
  fail "Expected exactly the subject and substitute Cardano clients after creation."

substitute_state="$(query_client_state "$SUBSTITUTE_CLIENT_ID")"
substitute_trusting_period="$(client_trusting_period_seconds "$substitute_state")"
(( substitute_trusting_period > subject_trusting_period )) ||
  fail "Substitute trusting period is not longer than the expiring subject fixture."
[[ "$(client_recovery_invariants "$substitute_state")" == "$subject_invariants" ]] ||
  fail "Subject and substitute recovery invariants differ."
[[ "$(client_status "$SUBSTITUTE_CLIENT_ID")" == "Active" ]] ||
  fail "Substitute client is not Active."

echo "Sending a pre-recovery packet over the subject route..."
run_forward_token_transfer
subject_state="$(query_client_state "$SUBJECT_CLIENT_ID")"
subject_latest="$(client_latest_height "$subject_state")"
subject_checkpoint="$(client_checkpoint_height "$subject_state")"
[[ "$(client_trusting_period_seconds "$subject_state")" == "$SUBJECT_TRUSTING_PERIOD_SECONDS" ]] ||
  fail "Pre-recovery packet unexpectedly changed the subject trusting period."
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == "Active" ]] ||
  fail "Subject is not Active after the pre-recovery packet."

echo "Advancing only the substitute beyond the refreshed subject..."
substitute_state="$(wait_for_substitute_newer "$subject_latest" "$subject_checkpoint")"
substitute_latest="$(client_latest_height "$substitute_state")"
substitute_checkpoint="$(client_checkpoint_height "$substitute_state")"
substitute_trusting_period="$(client_trusting_period_seconds "$substitute_state")"
[[ "$(client_recovery_invariants "$substitute_state")" == "$subject_invariants" ]] ||
  fail "Updated substitute no longer matches the recovery invariants."

COSMOS_RECEIVER="$(query_cosmos_relayer_address)"
route_after_prepacket="$(query_route_snapshot)"
[[ "$route_after_prepacket" == "$route_initial" ]] ||
  fail "The pre-recovery packet changed the connection or channel end."
voucher_before="$(query_voucher_snapshot "$COSMOS_RECEIVER")"
voucher_denom="$(jq -r '.denom' <<<"$voucher_before")"
voucher_amount_before="$(jq -r '.amount' <<<"$voucher_before")"
voucher_trace_before="$(query_voucher_trace "$voucher_denom")"
[[ "$voucher_amount_before" == "$RECOVERY_TRANSFER_AMOUNT" ]] ||
  fail "Fresh pre-recovery voucher balance is ${voucher_amount_before}; expected ${RECOVERY_TRANSFER_AMOUNT}."

echo "Submitting an unreceived Cosmos -> Cardano packet to preserve across recovery..."
baseline_commitments="$(query_cosmos_commitments)"
baseline_sequences="$(jq -c '.seqs' <<<"$baseline_commitments")"
ESCROW_ADDRESS="$(query_escrow_address)"
timeout_sender_balance_before="$(query_bank_balance "$COSMOS_RECEIVER" utest)"
timeout_escrow_balance_before="$(query_bank_balance "$ESCROW_ADDRESS" utest)"
timeout_sequence="$(submit_timeout_transfer)"
wait_for_commitment_membership "$timeout_sequence"
timeout_sender_balance_escrowed="$(query_bank_balance "$COSMOS_RECEIVER" utest)"
timeout_escrow_balance_escrowed="$(query_bank_balance "$ESCROW_ADDRESS" utest)"
sender_before_amount="$(jq -r '.amount' <<<"$timeout_sender_balance_before")"
sender_escrowed_amount="$(jq -r '.amount' <<<"$timeout_sender_balance_escrowed")"
escrow_before_amount="$(jq -r '.amount' <<<"$timeout_escrow_balance_before")"
escrowed_amount="$(jq -r '.amount' <<<"$timeout_escrow_balance_escrowed")"
(( 10#$sender_before_amount - 10#$sender_escrowed_amount == 1 )) ||
  fail "Timed packet did not debit exactly 1utest from its sender."
(( 10#$escrowed_amount - 10#$escrow_before_amount == 1 )) ||
  fail "Timed packet did not escrow exactly 1utest."

route_before_recovery="$(query_route_snapshot)"
[[ "$route_before_recovery" == "$route_after_prepacket" ]] ||
  fail "The pending packet changed the connection or channel end."
cardano_commitments_before="$(wait_for_commitment_sequences \
  "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID")"
cosmos_commitments_before="$(wait_for_commitment_sequences \
  "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID")"
jq -e --argjson sequence "$timeout_sequence" 'index($sequence) != null' \
  >/dev/null <<<"$cosmos_commitments_before" ||
  fail "The timeout packet commitment was not present in the pre-recovery snapshot."
channel_sequences_before="$(query_channel_sequences)"

echo "Waiting for the on-chain subject status to become Expired..."
wait_for_subject_expiry
echo "Subject ${SUBJECT_CLIENT_ID} is genuinely Expired; substitute ${SUBSTITUTE_CLIENT_ID} remains Active."

echo "Submitting recovery through the ibc-go governance authority path..."
proposal_id="$(submit_recovery_proposal)"
vote_for_recovery "$proposal_id"
wait_for_proposal_passed "$proposal_id"

[[ "$(client_status "$SUBJECT_CLIENT_ID")" == "Active" ]] ||
  fail "Subject client did not become Active after proposal ${proposal_id} passed."
recovered_state="$(query_client_state "$SUBJECT_CLIENT_ID")"
[[ "$(client_recovered_projection "$recovered_state")" == "$(client_recovered_projection "$substitute_state")" ]] ||
  fail "Recovered subject state does not match the substitute recovery projection."
jq -e '
  .operational_certificate_counter_history_start_height == .latest_checkpoint_height
' >/dev/null <<<"$recovered_state" ||
  fail "Recovered subject did not reset its operational-certificate counter history to the recovered checkpoint."
[[ "$(query_route_snapshot)" == "$route_before_recovery" ]] ||
  fail "Recovery changed the original connection or channel end."
[[ "$(discover_subject_client_id)" == "$SUBJECT_CLIENT_ID" ]] ||
  fail "The original route no longer references the subject client identifier."
[[ "$(wait_for_commitment_sequences "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID")" == "$cardano_commitments_before" ]] ||
  fail "Recovery changed Cardano packet commitments."
[[ "$(wait_for_commitment_sequences "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID")" == "$cosmos_commitments_before" ]] ||
  fail "Recovery changed Cosmos packet commitments."
[[ "$(query_channel_sequences)" == "$channel_sequences_before" ]] ||
  fail "Recovery changed Cosmos channel sequence state."
[[ "$(query_voucher_snapshot "$COSMOS_RECEIVER")" == "$voucher_before" ]] ||
  fail "Recovery changed the existing Cosmos voucher denomination or balance."
[[ "$(query_voucher_trace "$voucher_denom")" == "$voucher_trace_before" ]] ||
  fail "Recovery changed the Cosmos voucher denomination trace."
[[ "$(query_bank_balance "$COSMOS_RECEIVER" utest)" == "$timeout_sender_balance_escrowed" ]] ||
  fail "Recovery changed the pending packet sender balance."
[[ "$(query_bank_balance "$ESCROW_ADDRESS" utest)" == "$timeout_escrow_balance_escrowed" ]] ||
  fail "Recovery changed the pending packet escrow balance."

echo "Sending the post-recovery packet; its later Cardano root drives the first normal subject update..."
run_forward_token_transfer
updated_state="$(query_client_state "$SUBJECT_CLIENT_ID")"
updated_latest="$(client_latest_height "$updated_state")"
updated_checkpoint="$(client_checkpoint_height "$updated_state")"
(( updated_latest > substitute_latest )) ||
  fail "Post-recovery packet did not advance subject latest height beyond ${substitute_latest}."
(( updated_checkpoint > substitute_checkpoint )) ||
  fail "Post-recovery packet did not advance subject checkpoint beyond ${substitute_checkpoint}."
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == "Active" ]] ||
  fail "Recovered subject is not Active after its first normal packet-driven update."

voucher_after="$(query_voucher_snapshot "$COSMOS_RECEIVER")"
[[ "$(jq -r '.denom' <<<"$voucher_after")" == "$voucher_denom" ]] ||
  fail "Post-recovery transfer created a different Cosmos voucher denomination."
[[ "$(query_voucher_trace "$voucher_denom")" == "$voucher_trace_before" ]] ||
  fail "Post-recovery transfer changed the Cosmos voucher denomination trace."
voucher_amount_after="$(jq -r '.amount' <<<"$voucher_after")"
(( 10#$voucher_amount_after - 10#$voucher_amount_before == 10#$RECOVERY_TRANSFER_AMOUNT )) ||
  fail "Post-recovery voucher balance did not increase by ${RECOVERY_TRANSFER_AMOUNT}."

echo "Relaying the pending timeout to exercise VerifyNonMembership..."
wait_for_timeout_with_nonmembership_proof "$timeout_sequence"
wait_for_commitment_baseline "$baseline_sequences"
[[ "$(query_bank_balance "$COSMOS_RECEIVER" utest)" == "$timeout_sender_balance_before" ]] ||
  fail "Timeout did not restore the sender's exact utest balance."
[[ "$(query_bank_balance "$ESCROW_ADDRESS" utest)" == "$timeout_escrow_balance_before" ]] ||
  fail "Timeout did not restore the channel's exact utest escrow balance."
[[ "$(client_status "$SUBJECT_CLIENT_ID")" == "Active" ]] ||
  fail "Recovered subject is not Active after verifying the timeout non-membership proof."

[[ "$(query_route_snapshot)" == "$route_before_recovery" ]] ||
  fail "Post-recovery transfers changed the original connection or channel end."
[[ "$(discover_subject_client_id)" == "$SUBJECT_CLIENT_ID" ]] ||
  fail "Post-recovery transfers did not use the original subject client identifier."
[[ "$(wait_for_commitment_sequences "$CARDANO_CHAIN_ID" "$CARDANO_COSMOS_CHANNEL_ID")" == "$cardano_commitments_before" ]] ||
  fail "Post-recovery packet left a Cardano commitment behind."
[[ "$(wait_for_commitment_sequences "$COSMOS_CHAIN_ID" "$COSMOS_CARDANO_CHANNEL_ID")" == "$baseline_sequences" ]] ||
  fail "Post-recovery flows left a Cosmos commitment behind."

echo "Light-client recovery completed: proposal ${proposal_id} recovered ${SUBJECT_CLIENT_ID} from ${SUBSTITUTE_CLIENT_ID}, and the original route passed membership and non-membership flows."
