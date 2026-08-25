#!/usr/bin/env bash

set -Eeuo pipefail

get_arg() {
  local name="$1"
  shift
  while (( $# > 0 )); do
    if [[ "$1" == "$name" ]]; then
      printf '%s\n' "${2:-}"
      return 0
    fi
    shift
  done
  return 1
}

record_event() {
  printf '%s\n' "$*" >>"$FAKE_EVENT_LOG"
}

emit_hermes() {
  local result="$1"
  echo '{"timestamp":"2026-08-24T00:00:00Z","level":"INFO","fields":{"message":"fake Hermes log"}}'
  printf '{"result":%s,"status":"success"}\n' "$result"
}

emit_client_state() {
  local client_id="$1"
  local latest=100
  local checkpoint=110
  local trusting=300
  local epoch=1

  if [[ "$client_id" == "08-cardano-probabilistic-1" ]]; then
    trusting=315360000
    epoch=2
    if [[ -f "$FAKE_STATE_DIR/substitute-updated" ]]; then
      latest=140
      checkpoint=150
    fi
  elif [[ -f "$FAKE_STATE_DIR/recovered" ]]; then
    trusting=315360000
    epoch=2
    latest=140
    checkpoint=150
    if [[ -f "$FAKE_STATE_DIR/post-forward" ]]; then
      epoch=3
      latest=160
      checkpoint=170
    fi
  elif [[ -f "$FAKE_STATE_DIR/pre-forward" ]]; then
    latest=120
    checkpoint=130
  fi

  {
    printf '{"chain_id":"cardano-devnet","latest_height":{"revision_number":0,"revision_height":%s},"frozen_height":null,"current_epoch":%s,"trusting_period":{"secs":%s,"nanos":0},"upgrade_path":[],"host_state_nft_policy_id":[1,2,3],"host_state_nft_token_name":[4,5],"epoch_stake_distribution":[{"pool_id":"pool","stake":100,"relative_stake_numerator":1,"relative_stake_denominator":1}],"epoch_nonce":[9,9],"slots_per_kes_period":20,"current_epoch_start_slot":100,"current_epoch_end_slot_exclusive":200,"system_start_unix_ns":1000000000,"slot_length_ns":1000000000,"epoch_contexts":[{"epoch":%s,"stake_distribution":[{"pool_id":"pool","stake":100,"relative_stake_numerator":1,"relative_stake_denominator":1}]}],"latest_checkpoint_height":{"revision_number":0,"revision_height":%s},"latest_checkpoint_block_hash":"hash-%s","latest_checkpoint_epoch":%s,"max_kes_evolutions":62,"latest_checkpoint_operational_certificate_counters":[{"pool_id":"pool","sequence_number":1}],"operational_certificate_counter_history_start_height":{"revision_number":0,"revision_height":%s},"active_slot_coefficient_numerator":1,"active_slot_coefficient_denominator":20,"max_clock_drift":{"secs":5,"nanos":0},"latest_checkpoint_slot":%s,"latest_checkpoint_timestamp":%s000000000}' \
      "$latest" "$epoch" "$trusting" "$epoch" "$checkpoint" "$checkpoint" "$epoch" "$checkpoint" "$checkpoint" "$((checkpoint + 1))"
  } | if [[ "${FAKE_MISSING_RELATIVE_STAKE:-0}" == "1" ]]; then
    jq -c 'del(.epoch_stake_distribution[0].relative_stake_numerator, .epoch_contexts[0].stake_distribution[0].relative_stake_denominator)'
  else
    cat
  fi
}

fake_hermes() {
  local args=("$@")
  if [[ "${args[0]:-}" == "--json" ]]; then
    args=("${args[@]:1}")
  fi
  record_event "hermes ${args[*]}"

  local command="${args[0]:-} ${args[1]:-} ${args[2]:-}"
  local client_id chain
  case "$command" in
    "query channel end")
      emit_hermes '{"state":"Open","ordering":"Unordered","connection_hops":["connection-0"],"remote":{"port_id":"transfer","channel_id":"channel-0"},"version":"ics20-1"}'
      ;;
    "query connection end")
      emit_hermes '{"state":"Open","client_id":"08-cardano-probabilistic-0","counterparty":{"client_id":"07-tendermint-0","connection_id":"connection-0"},"delay_period":0}'
      ;;
    "query clients --host-chain")
      if [[ "${FAKE_MALFORMED_CLIENTS:-0}" == "1" ]]; then
        echo '{"timestamp":"2026-08-24T00:00:00Z","level":"INFO"}'
      elif [[ -f "$FAKE_STATE_DIR/substitute-created" ]]; then
        emit_hermes '["08-cardano-probabilistic-0","08-cardano-probabilistic-1"]'
      else
        emit_hermes '["08-cardano-probabilistic-0"]'
      fi
      ;;
    "query client state")
      client_id="$(get_arg --client "${args[@]}")"
      emit_hermes "$(emit_client_state "$client_id")"
      ;;
    "create client --host-chain")
      : >"$FAKE_STATE_DIR/substitute-created"
      record_event "state substitute-created"
      emit_hermes '{"CreateClient":{"client_id":"08-cardano-probabilistic-1","client_type":"08-cardano-probabilistic","consensus_height":{"revision_number":0,"revision_height":100}}}'
      ;;
    "update client --host-chain")
      client_id="$(get_arg --client "${args[@]}")"
      if [[ "$client_id" != "08-cardano-probabilistic-1" ]]; then
        emit_hermes '"the subject must only update through a post-recovery packet"' | sed 's/"success"/"error"/'
        return 1
      fi
      [[ -f "$FAKE_STATE_DIR/pre-forward" ]] || {
        emit_hermes '"no later HostState root"' | sed 's/"success"/"error"/'
        return 1
      }
      if [[ "${FAKE_UNKNOWN_SUBSTITUTE_UPDATE:-0}" == "1" ]]; then
        emit_hermes '"unauthorized substitute update"' | sed 's/"success"/"error"/'
        return 1
      fi
      : >"$FAKE_STATE_DIR/substitute-updated"
      record_event "state substitute-updated"
      emit_hermes '[{"UpdateClient":{"client_id":"08-cardano-probabilistic-1"}}]'
      ;;
    "query packet commitments")
      chain="$(get_arg --chain "${args[@]}")"
      if [[ "$chain" == "v8-classic-1" || "$chain" == "v10-classic-1" ]]; then
        if [[ -f "$FAKE_STATE_DIR/timeout-pending" ]]; then
          emit_hermes '{"height":{"revision_number":1,"revision_height":250},"seqs":[7]}'
        else
          emit_hermes '{"height":{"revision_number":1,"revision_height":250},"seqs":[]}'
        fi
      else
        emit_hermes '{"height":{"revision_number":0,"revision_height":180},"seqs":[]}'
      fi
      ;;
    "tx ft-transfer --src-chain")
      : >"$FAKE_STATE_DIR/timeout-pending"
      record_event "state timeout-pending"
      emit_hermes '[{"event":{"SendPacket":{"packet":{"sequence":7}}},"height":{"revision_number":1,"revision_height":300}}]'
      ;;
    "tx packet-recv --src-chain")
      if [[ "${FAKE_FAIL_TIMEOUT:-0}" == "1" ]]; then
        echo '{"result":"unauthorized packet relay","status":"error"}'
        return 1
      fi
      if [[ ! -f "$FAKE_STATE_DIR/timeout-retried" ]]; then
        : >"$FAKE_STATE_DIR/timeout-retried"
        echo '{"result":"HEIGHT_NOT_ACCEPTED: stability thresholds not met","status":"error"}'
        return 1
      fi
      rm -f "$FAKE_STATE_DIR/timeout-pending"
      : >"$FAKE_STATE_DIR/timeout-complete"
      record_event "state timeout-complete"
      emit_hermes '[{"TimeoutPacket":{"packet":{"sequence":7}}}]'
      ;;
    *)
      echo "unexpected fake Hermes command: ${args[*]}" >&2
      return 1
      ;;
  esac
}

fake_subject_status() {
  if [[ -f "$FAKE_STATE_DIR/recovered" ]]; then
    echo Active
    return 0
  fi
  if [[ ! -f "$FAKE_STATE_DIR/substitute-updated" ]]; then
    echo Active
    return 0
  fi

  local count=0
  if [[ -f "$FAKE_STATE_DIR/post-subject-status-count" ]]; then
    count="$(<"$FAKE_STATE_DIR/post-subject-status-count")"
  fi
  count=$((count + 1))
  printf '%s\n' "$count" >"$FAKE_STATE_DIR/post-subject-status-count"
  if (( count == 1 )); then
    echo Active
  else
    record_event "state subject-expired"
    echo Expired
  fi
}

fake_bank_balances() {
  local address="$1"
  local voucher_amount=0
  if [[ -f "$FAKE_STATE_DIR/pre-forward" ]]; then
    voucher_amount=12345
  fi
  if [[ -f "$FAKE_STATE_DIR/post-forward" ]]; then
    voucher_amount=24690
  fi

  if [[ "$address" == "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt" ]]; then
    printf '{"balances":[{"denom":"stake","amount":"100000000000"},{"denom":"utest","amount":"100000"},{"denom":"ibc/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","amount":"%s"}],"pagination":{"total":"3"}}\n' "$voucher_amount"
  else
    echo '{"balances":[],"pagination":{"total":"0"}}'
  fi
}

fake_bank_balance() {
  local address="$1"
  local denom="$2"
  local amount=100000
  if [[ "$address" == "cosmos1escrow00000000000000000000000000000000" ]]; then
    amount=0
  fi
  if [[ -f "$FAKE_STATE_DIR/timeout-pending" ]]; then
    if [[ "$address" == "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt" ]]; then
      amount=99999
    else
      amount=1
    fi
  fi
  printf '{"balance":{"denom":"%s","amount":"%s"}}\n' "$denom" "$amount"
}

fake_simd() {
  local args=("$@")
  record_event "simd ${args[*]}"
  if [[ "${FAKE_HANG_SIMD:-0}" == "1" ]]; then
    (
      sleep 2
      : >"$FAKE_LATE_MARKER"
    ) &
    sleep 20
    return 1
  fi
  local command="${args[0]:-} ${args[1]:-} ${args[2]:-} ${args[3]:-}"
  local client_id tx_hash address denom
  case "$command" in
    "query ibc client status")
      client_id="${args[4]:-}"
      if [[ "$client_id" == "08-cardano-probabilistic-1" ]]; then
        echo '{"status":"Active"}'
      else
        printf '{"status":"%s"}\n' "$(fake_subject_status)"
      fi
      ;;
    "query ibc channel next-sequence-send")
      if [[ -f "$FAKE_STATE_DIR/timeout-pending" ]]; then
        echo '{"next_sequence_send":"2","proof":"","proof_height":{"revision_number":"1","revision_height":"20"}}'
      else
        echo '{"next_sequence_send":"1","proof":"","proof_height":{"revision_number":"1","revision_height":"20"}}'
      fi
      ;;
    "query ibc channel next-sequence-receive")
      if [[ -f "$FAKE_STATE_DIR/post-forward" ]]; then
        echo '{"next_sequence_receive":"3","proof":"","proof_height":{"revision_number":"1","revision_height":"20"}}'
      elif [[ -f "$FAKE_STATE_DIR/pre-forward" ]]; then
        echo '{"next_sequence_receive":"2","proof":"","proof_height":{"revision_number":"1","revision_height":"20"}}'
      else
        echo '{"next_sequence_receive":"1","proof":"","proof_height":{"revision_number":"1","revision_height":"20"}}'
      fi
      ;;
    "query bank balances "*)
      address="${args[3]:-}"
      fake_bank_balances "$address"
      ;;
    "query bank balance "*)
      address="${args[3]:-}"
      denom="${args[4]:-}"
      fake_bank_balance "$address" "$denom"
      ;;
    "query ibc-transfer denom-trace "*)
      echo '{"denom_trace":{"path":"transfer/channel-0","base_denom":"mock-token"}}'
      ;;
    "query ibc-transfer denom "*)
      echo '{"denom":{"base":"mock-token","trace":[{"port_id":"transfer","channel_id":"channel-0"}]}}'
      ;;
    "query ibc-transfer escrow-address "*)
      echo 'cosmos1escrow00000000000000000000000000000000'
      ;;
    "query tx "*)
      tx_hash="${args[2]:-}"
      if [[ "$tx_hash" == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" ]]; then
        echo '{"height":"12","txhash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","code":0,"events":[{"type":"submit_proposal","attributes":[{"key":"proposal_id","value":"1"}]}]}'
      else
        echo '{"height":"13","txhash":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","code":0,"events":[]}'
      fi
      ;;
    "query gov proposal "*)
      if [[ "${FAKE_FAIL_PROPOSAL:-0}" == "1" ]]; then
        echo '{"proposal":{"id":"1","status":"PROPOSAL_STATUS_FAILED","failed_reason":"simulated recovery failure"}}'
      else
        : >"$FAKE_STATE_DIR/recovered"
        record_event "state proposal-passed"
        echo '{"proposal":{"id":"1","status":"PROPOSAL_STATUS_PASSED","failed_reason":""}}'
      fi
      ;;
    "keys show relayer --keyring-backend")
      echo '{"name":"relayer","type":"local","address":"cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt","pubkey":{}}'
      ;;
    "tx ibc client recover-client")
      echo 'gas estimate: 123456' >&2
      echo '{"height":"0","txhash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","code":0,"raw_log":""}'
      ;;
    "tx gov vote 1")
      echo 'gas estimate: 65432' >&2
      echo '{"height":"0","txhash":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","code":0,"raw_log":""}'
      ;;
    *)
      echo "unexpected fake simd command: ${args[*]}" >&2
      return 1
      ;;
  esac
}

fake_direct_transfer() {
  [[ "$COSMOS_DEMO_DIRECTION" == "cardano-to-cosmos" ]]
  [[ "$CARIBIC_TOKEN_SWAP_AMOUNT" == "12345" ]]
  [[ "$CARDANO_SEND_DENOM" == "mock-token" ]]
  [[ "$CARDANO_CLIENT_ID" == "08-cardano-probabilistic-0" ]]

  if [[ ! -f "$FAKE_STATE_DIR/recovered" ]]; then
    [[ -f "$FAKE_STATE_DIR/substitute-created" ]]
    [[ ! -f "$FAKE_STATE_DIR/pre-forward" ]]
    : >"$FAKE_STATE_DIR/pre-forward"
    record_event "state pre-forward-membership"
  else
    [[ -f "$FAKE_STATE_DIR/timeout-pending" ]]
    [[ ! -f "$FAKE_STATE_DIR/post-forward" ]]
    : >"$FAKE_STATE_DIR/post-forward"
    record_event "state post-forward-membership"
  fi
  echo "Direct Cardano-to-${COSMOS_PROFILE} Classic transfer completed."
}

case "$(basename "$0")" in
  fake-hermes)
    fake_hermes "$@"
    exit $?
    ;;
  fake-simd)
    fake_simd "$@"
    exit $?
    ;;
  fake-direct-token-swap)
    fake_direct_transfer "$@"
    exit $?
    ;;
esac

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/caribic-recovery-test.XXXXXX")"
trap 'rm -rf -- "$test_dir"' EXIT
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
recovery_script="$script_dir/run_light_client_recovery.sh"
fake_hermes_bin="$test_dir/fake-hermes"
fake_simd_bin="$test_dir/fake-simd"
fake_direct_script="$test_dir/fake-direct-token-swap"
ln -s "$script_dir/$(basename "$0")" "$fake_hermes_bin"
ln -s "$script_dir/$(basename "$0")" "$fake_simd_bin"
ln -s "$script_dir/$(basename "$0")" "$fake_direct_script"

run_recovery() {
  local profile="$1"
  local chain_id="$2"
  env \
    CARIBIC_PROJECT_ROOT="$test_dir/repo" \
    HERMES_BIN="$fake_hermes_bin" \
    SIMD_BIN="$fake_simd_bin" \
    DIRECT_TOKEN_SWAP_SCRIPT="$fake_direct_script" \
    COSMOS_PROFILE="$profile" \
    CARDANO_CHAIN_ID="cardano-devnet" \
    COSMOS_CHAIN_ID="$chain_id" \
    CARDANO_COSMOS_CHANNEL_ID="channel-0" \
    COSMOS_CARDANO_CHANNEL_ID="channel-0" \
    SUBJECT_TRUSTING_PERIOD_SECONDS="300" \
    RECOVERY_TRANSFER_AMOUNT="12345" \
    CARDANO_SEND_DENOM="mock-token" \
    RECOVERY_POLL_INTERVAL_SECONDS="0" \
    RECOVERY_QUERY_TIMEOUT_SECONDS="${TEST_QUERY_TIMEOUT_SECONDS:-5}" \
    RECOVERY_COMMAND_TIMEOUT_SECONDS="5" \
    RECOVERY_TX_COMMIT_TIMEOUT_SECONDS="5" \
    RECOVERY_EXPIRY_TIMEOUT_SECONDS="5" \
    RECOVERY_GOVERNANCE_TIMEOUT_SECONDS="5" \
    RECOVERY_SUBSTITUTE_UPDATE_TIMEOUT_SECONDS="5" \
    RECOVERY_NONMEMBERSHIP_TIMEOUT_SECONDS="1" \
    RECOVERY_PACKET_TIMEOUT_SECONDS="5" \
    FAKE_STATE_DIR="$FAKE_STATE_DIR" \
    FAKE_EVENT_LOG="$FAKE_EVENT_LOG" \
    FAKE_FAIL_PROPOSAL="${FAKE_FAIL_PROPOSAL:-0}" \
    FAKE_FAIL_TIMEOUT="${FAKE_FAIL_TIMEOUT:-0}" \
    FAKE_MALFORMED_CLIENTS="${FAKE_MALFORMED_CLIENTS:-0}" \
    FAKE_MISSING_RELATIVE_STAKE="${FAKE_MISSING_RELATIVE_STAKE:-0}" \
    FAKE_UNKNOWN_SUBSTITUTE_UPDATE="${FAKE_UNKNOWN_SUBSTITUTE_UPDATE:-0}" \
    FAKE_HANG_SIMD="${FAKE_HANG_SIMD:-0}" \
    FAKE_LATE_MARKER="${FAKE_LATE_MARKER:-}" \
    bash "$recovery_script"
}

assert_order() {
  local first="$1"
  local second="$2"
  local first_line second_line
  first_line="$(grep -nF "$first" "$FAKE_EVENT_LOG" | head -n 1 | cut -d: -f1)"
  second_line="$(grep -nF "$second" "$FAKE_EVENT_LOG" | head -n 1 | cut -d: -f1)"
  [[ -n "$first_line" && -n "$second_line" && "$first_line" -lt "$second_line" ]] || {
    echo "Expected '$first' before '$second'." >&2
    cat "$FAKE_EVENT_LOG" >&2
    return 1
  }
}

run_success_case() {
  local profile="$1"
  local chain_id="$2"
  FAKE_STATE_DIR="$test_dir/${profile}-success-state"
  FAKE_EVENT_LOG="$test_dir/${profile}-success.log"
  mkdir -p "$FAKE_STATE_DIR"
  local output
  output="$(run_recovery "$profile" "$chain_id" 2>&1)"
  grep -qF "Light-client recovery completed" <<<"$output"
  [[ -f "$FAKE_STATE_DIR/timeout-complete" ]]
  [[ ! -f "$FAKE_STATE_DIR/timeout-pending" ]]
  assert_order "state substitute-created" "state pre-forward-membership"
  assert_order "state pre-forward-membership" "state substitute-updated"
  assert_order "state substitute-updated" "state timeout-pending"
  assert_order "state timeout-pending" "state subject-expired"
  assert_order "state subject-expired" "simd tx ibc client recover-client"
  assert_order "simd tx gov vote 1" "state proposal-passed"
  assert_order "state proposal-passed" "state post-forward-membership"
  assert_order "state post-forward-membership" "state timeout-complete"
  if grep -qF "update client --host-chain ${chain_id} --client 08-cardano-probabilistic-0" "$FAKE_EVENT_LOG"; then
    echo "The orchestration directly updated the subject instead of using a packet proof." >&2
    return 1
  fi
}

run_success_case v8-classic v8-classic-1
run_success_case v10-classic v10-classic-1

FAKE_STATE_DIR="$test_dir/proposal-failure-state"
FAKE_EVENT_LOG="$test_dir/proposal-failure.log"
FAKE_FAIL_PROPOSAL=1
mkdir -p "$FAKE_STATE_DIR"
if proposal_failure_output="$(run_recovery v8-classic v8-classic-1 2>&1)"; then
  echo "Recovery unexpectedly accepted a failed governance proposal." >&2
  exit 1
fi
grep -qF "PROPOSAL_STATUS_FAILED" <<<"$proposal_failure_output"
if grep -qF "state post-forward-membership" "$FAKE_EVENT_LOG" ||
  grep -qF "state timeout-complete" "$FAKE_EVENT_LOG"; then
  echo "Recovery relayed a post-recovery packet after proposal failure." >&2
  exit 1
fi
unset FAKE_FAIL_PROPOSAL

FAKE_STATE_DIR="$test_dir/substitute-update-failure-state"
FAKE_EVENT_LOG="$test_dir/substitute-update-failure.log"
FAKE_UNKNOWN_SUBSTITUTE_UPDATE=1
mkdir -p "$FAKE_STATE_DIR"
if substitute_update_failure_output="$(run_recovery v8-classic v8-classic-1 2>&1)"; then
  echo "Recovery unexpectedly accepted an unknown substitute update failure." >&2
  exit 1
fi
grep -qF "unauthorized substitute update" <<<"$substitute_update_failure_output"
if grep -qF "simd tx ibc client recover-client" "$FAKE_EVENT_LOG"; then
  echo "Recovery submitted governance after substitute update failure." >&2
  exit 1
fi
unset FAKE_UNKNOWN_SUBSTITUTE_UPDATE

FAKE_STATE_DIR="$test_dir/missing-relative-stake-state"
FAKE_EVENT_LOG="$test_dir/missing-relative-stake.log"
FAKE_MISSING_RELATIVE_STAKE=1
mkdir -p "$FAKE_STATE_DIR"
if missing_relative_stake_output="$(run_recovery v8-classic v8-classic-1 2>&1)"; then
  echo "Recovery unexpectedly accepted client state without exact relative stake." >&2
  exit 1
fi
grep -qF "invalid probabilistic client state" <<<"$missing_relative_stake_output"
if grep -qF "create client" "$FAKE_EVENT_LOG"; then
  echo "Recovery created a substitute after incomplete relative-stake state." >&2
  exit 1
fi
unset FAKE_MISSING_RELATIVE_STAKE

FAKE_STATE_DIR="$test_dir/timeout-failure-state"
FAKE_EVENT_LOG="$test_dir/timeout-failure.log"
FAKE_FAIL_TIMEOUT=1
mkdir -p "$FAKE_STATE_DIR"
if timeout_failure_output="$(run_recovery v8-classic v8-classic-1 2>&1)"; then
  echo "Recovery unexpectedly accepted an unknown packet-timeout failure." >&2
  exit 1
fi
grep -qF "unauthorized packet relay" <<<"$timeout_failure_output"
[[ ! -f "$FAKE_STATE_DIR/timeout-complete" ]]
unset FAKE_FAIL_TIMEOUT

FAKE_STATE_DIR="$test_dir/malformed-client-state"
FAKE_EVENT_LOG="$test_dir/malformed-client.log"
FAKE_MALFORMED_CLIENTS=1
mkdir -p "$FAKE_STATE_DIR"
if malformed_output="$(run_recovery v8-classic v8-classic-1 2>&1)"; then
  echo "Recovery unexpectedly accepted Hermes output without a status envelope." >&2
  exit 1
fi
if grep -qF "Light-client recovery completed" <<<"$malformed_output"; then
  echo "Recovery printed success after malformed Hermes output." >&2
  exit 1
fi
if grep -qF "create client" "$FAKE_EVENT_LOG"; then
  echo "Recovery created a substitute after malformed client inventory output." >&2
  exit 1
fi

FAKE_STATE_DIR="$test_dir/timeout-cleanup-state"
FAKE_EVENT_LOG="$test_dir/timeout-cleanup.log"
FAKE_LATE_MARKER="$test_dir/late-simd-side-effect"
FAKE_HANG_SIMD=1
TEST_QUERY_TIMEOUT_SECONDS=1
mkdir -p "$FAKE_STATE_DIR"
if timeout_cleanup_output="$(run_recovery v8-classic v8-classic-1 2>&1)"; then
  echo "Recovery unexpectedly accepted a timed-out simd command." >&2
  printf '%s\n' "$timeout_cleanup_output" >&2
  exit 1
fi
sleep 3
if [[ -e "$FAKE_LATE_MARKER" ]]; then
  echo "A timed-out simd descendant continued running after harness failure." >&2
  exit 1
fi
unset FAKE_HANG_SIMD FAKE_LATE_MARKER TEST_QUERY_TIMEOUT_SECONDS

echo "Light-client recovery orchestration tests passed."
