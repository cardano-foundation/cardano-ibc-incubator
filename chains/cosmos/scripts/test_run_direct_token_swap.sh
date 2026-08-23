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

fake_hermes() {
  local args=("$@")
  local json_mode=false
  if [[ "${args[0]:-}" == "--json" ]]; then
    json_mode=true
    args=("${args[@]:1}")
  fi
  printf '%s\n' "${args[*]}" >>"$FAKE_HERMES_LOG"
  if [[ "$json_mode" == "true" ]]; then
    echo '{"timestamp":"2026-08-23T00:00:00Z","level":"INFO","fields":{"message":"fake Hermes log"}}'
  fi

  local command="${args[0]:-} ${args[1]:-} ${args[2]:-}"
  local chain src_chain target_height latest_height
  case "$command" in
    "keys list "*)
      echo "v8-classic-1-relayer (cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt)"
      ;;
    "query packet commitments")
      if [[ "${FAKE_FAIL_COMMITMENT_QUERY:-0}" == "1" ]]; then
        echo '{"result":"simulated commitment query failure","status":"error"}'
        return 1
      fi
      chain="$(get_arg --chain "${args[@]}")"
      if [[ "$chain" == "cardano-devnet" ]]; then
        if [[ -f "$FAKE_STATE_DIR/cardano-commitment" ]]; then
          echo '{"result":{"height":{"revision_height":120,"revision_number":0},"seqs":[1]},"status":"success"}'
        else
          echo '{"result":{"height":{"revision_height":120,"revision_number":0},"seqs":[]},"status":"success"}'
        fi
      elif [[ -f "$FAKE_STATE_DIR/cosmos-commitment" ]]; then
        echo '{"result":{"height":{"revision_height":260,"revision_number":1},"seqs":[1]},"status":"success"}'
      else
        echo '{"result":{"height":{"revision_height":260,"revision_number":1},"seqs":[]},"status":"success"}'
      fi
      ;;
    "tx ft-transfer "*)
      src_chain="$(get_arg --src-chain "${args[@]}")"
      if [[ "$src_chain" == "cardano-devnet" ]]; then
        printf '1\n' >"$FAKE_STATE_DIR/cardano-commitment"
        echo '{"result":[{"event":{"SendPacket":{"packet":{"sequence":1}}},"height":{"revision_height":100,"revision_number":0}}],"status":"success"}'
      else
        printf '1\n' >"$FAKE_STATE_DIR/cosmos-commitment"
        echo '{"result":[{"event":{"SendPacket":{"packet":{"sequence":1}}},"height":{"revision_height":250,"revision_number":1}}],"status":"success"}'
      fi
      ;;
    "query channel end")
      echo '{"result":{"connection_hops":["connection-0"]},"status":"success"}'
      ;;
    "query connection end")
      echo '{"result":{"client_id":"08-cardano-probabilistic-0"},"status":"success"}'
      ;;
    "query client state")
      latest_height="0"
      [[ -f "$FAKE_STATE_DIR/client-height" ]] && latest_height="$(<"$FAKE_STATE_DIR/client-height")"
      printf '{"result":{"latest_height":{"revision_height":%s,"revision_number":0}},"status":"success"}\n' "$latest_height"
      ;;
    "update client "*)
      if [[ "${FAKE_FAIL_UPDATE:-0}" == "1" ]]; then
        echo '{"result":"simulated client update failure","status":"error"}'
        return 1
      fi
      target_height="$(get_arg --height "${args[@]}")"
      printf '%s\n' "$target_height" >"$FAKE_STATE_DIR/client-height"
      echo '{"result":[],"status":"success"}'
      ;;
    "query client consensus")
      target_height="$(get_arg --consensus-height "${args[@]}")"
      latest_height="0"
      [[ -f "$FAKE_STATE_DIR/client-height" ]] && latest_height="$(<"$FAKE_STATE_DIR/client-height")"
      if (( latest_height < target_height )); then
        echo '{"result":"consensus state not found","status":"error"}'
        return 1
      fi
      echo '{"result":{"root":"AABB"},"status":"success"}'
      ;;
    "tx packet-recv "*)
      src_chain="$(get_arg --src-chain "${args[@]}")"
      if [[ "$src_chain" == "cardano-devnet" ]]; then
        printf '1\n' >"$FAKE_STATE_DIR/cosmos-ack"
        echo '{"result":[{"WriteAcknowledgement":{"packet":{"sequence":1},"ack":"7B22726573756C74223A2241513D3D227D"}}],"status":"success"}'
      else
        printf '1\n' >"$FAKE_STATE_DIR/cardano-ack"
        echo '{"result":[{"WriteAcknowledgement":{"packet":{"sequence":1},"ack":"7B22726573756C74223A2241513D3D227D"}}],"status":"success"}'
      fi
      ;;
    "query packet acks")
      chain="$(get_arg --chain "${args[@]}")"
      if [[ "$chain" == "cardano-devnet" ]]; then
        if [[ ! -f "$FAKE_STATE_DIR/cardano-ack" ]]; then
          echo '{"result":null,"status":"success"}'
          return 0
        fi
        if [[ ! -f "$FAKE_STATE_DIR/stability-retried" ]]; then
          printf '1\n' >"$FAKE_STATE_DIR/stability-retried"
          echo '{"result":"HEIGHT_NOT_ACCEPTED: stability thresholds not met","status":"error"}'
          return 1
        fi
        echo '{"result":{"height":{"revision_height":465,"revision_number":0},"seqs":[1]},"status":"success"}'
      elif [[ ! -f "$FAKE_STATE_DIR/cosmos-ack" ]]; then
        echo '{"result":null,"status":"success"}'
      else
        echo '{"result":{"height":{"revision_height":205,"revision_number":1},"seqs":[1]},"status":"success"}'
      fi
      ;;
    "tx packet-ack "*)
      src_chain="$(get_arg --src-chain "${args[@]}")"
      if [[ "$src_chain" == "cardano-devnet" ]]; then
        [[ -f "$FAKE_STATE_DIR/cardano-ack" ]] || {
          echo '{"result":"Cardano acknowledgement is missing","status":"error"}'
          return 1
        }
        latest_height="$(<"$FAKE_STATE_DIR/client-height")"
        if (( latest_height < 465 )); then
          echo '{"result":"Cardano client is stale","status":"error"}'
          return 1
        fi
        rm -f "$FAKE_STATE_DIR/cosmos-commitment"
        rm -f "$FAKE_STATE_DIR/cardano-ack"
      else
        [[ -f "$FAKE_STATE_DIR/cosmos-ack" ]] || {
          echo '{"result":"Cosmos acknowledgement is missing","status":"error"}'
          return 1
        }
        rm -f "$FAKE_STATE_DIR/cardano-commitment"
        rm -f "$FAKE_STATE_DIR/cosmos-ack"
      fi
      echo '{"result":[],"status":"success"}'
      ;;
    *)
      echo "unexpected fake Hermes command: ${args[*]}" >&2
      return 1
      ;;
  esac
}

if [[ "$(basename "$0")" == "fake-hermes" ]]; then
  fake_hermes "$@"
  exit $?
fi

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/caribic-cosmos-demo-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
script_dir="$(cd "$(dirname "$0")" && pwd)"
demo_script="$script_dir/run_direct_token_swap.sh"
fake_binary="$test_dir/fake-hermes"
ln -s "$script_dir/$(basename "$0")" "$fake_binary"

mkdir -p "$test_dir/repo/cardano/offchain/deployments"
printf '{"tokens":{"mock":"mock-token"}}\n' >"$test_dir/repo/cardano/offchain/deployments/handler.json"

run_demo() {
  env \
    CARIBIC_PROJECT_ROOT="$test_dir/repo" \
    HERMES_BIN="$fake_binary" \
    HANDLER_JSON="$test_dir/repo/cardano/offchain/deployments/handler.json" \
    COSMOS_PROFILE="v8-classic" \
    CARDANO_CHAIN_ID="cardano-devnet" \
    COSMOS_CHAIN_ID="v8-classic-1" \
    CARDANO_COSMOS_CHANNEL_ID="channel-0" \
    COSMOS_CARDANO_CHANNEL_ID="channel-0" \
    DEMO_POLL_INTERVAL_SECONDS="0" \
    DEMO_SETTLEMENT_TIMEOUT_SECONDS="5" \
    DEMO_COMMAND_TIMEOUT_SECONDS="5" \
    DEMO_QUERY_TIMEOUT_SECONDS="5" \
    FAKE_STATE_DIR="$FAKE_STATE_DIR" \
    FAKE_HERMES_LOG="$FAKE_HERMES_LOG" \
    FAKE_FAIL_UPDATE="${FAKE_FAIL_UPDATE:-0}" \
    FAKE_FAIL_COMMITMENT_QUERY="${FAKE_FAIL_COMMITMENT_QUERY:-0}" \
    bash "$demo_script"
}

assert_order() {
  local first="$1"
  local second="$2"
  local first_line second_line
  first_line="$(grep -nF "$first" "$FAKE_HERMES_LOG" | head -n 1 | cut -d: -f1)"
  second_line="$(grep -nF "$second" "$FAKE_HERMES_LOG" | head -n 1 | cut -d: -f1)"
  [[ -n "$first_line" && -n "$second_line" && "$first_line" -lt "$second_line" ]] || {
    echo "Expected '$first' before '$second'." >&2
    cat "$FAKE_HERMES_LOG" >&2
    return 1
  }
}

FAKE_STATE_DIR="$test_dir/success-state"
FAKE_HERMES_LOG="$test_dir/success.log"
mkdir -p "$FAKE_STATE_DIR"
success_output="$(run_demo 2>&1)"
grep -qF "Direct Cardano-to-v8-classic Classic compatibility demo completed." <<<"$success_output"
[[ -f "$FAKE_STATE_DIR/stability-retried" ]]
[[ ! -f "$FAKE_STATE_DIR/cardano-commitment" ]]
[[ ! -f "$FAKE_STATE_DIR/cosmos-commitment" ]]
assert_order \
  "update client --host-chain v8-classic-1 --client 08-cardano-probabilistic-0 --height 120" \
  "tx packet-recv --src-chain cardano-devnet"
assert_order \
  "tx packet-recv --src-chain v8-classic-1" \
  "update client --host-chain v8-classic-1 --client 08-cardano-probabilistic-0 --height 465"
assert_order \
  "update client --host-chain v8-classic-1 --client 08-cardano-probabilistic-0 --height 465" \
  "tx packet-ack --src-chain cardano-devnet"
grep -qF "tx packet-ack --src-chain cardano-devnet --dst-chain v8-classic-1" "$FAKE_HERMES_LOG"
if grep -qF -- "--packet-data-query-height" "$FAKE_HERMES_LOG"; then
  echo "The demo pinned an event query to a proof height." >&2
  exit 1
fi

FAKE_STATE_DIR="$test_dir/update-failure-state"
FAKE_HERMES_LOG="$test_dir/update-failure.log"
FAKE_FAIL_UPDATE=1
mkdir -p "$FAKE_STATE_DIR"
if failure_output="$(run_demo 2>&1)"; then
  echo "The demo unexpectedly accepted a failed client update." >&2
  exit 1
fi
grep -qF "simulated client update failure" <<<"$failure_output"
if grep -qF "compatibility demo completed" <<<"$failure_output"; then
  echo "The demo printed a success message after a failed client update." >&2
  exit 1
fi
unset FAKE_FAIL_UPDATE

FAKE_STATE_DIR="$test_dir/query-failure-state"
FAKE_HERMES_LOG="$test_dir/query-failure.log"
FAKE_FAIL_COMMITMENT_QUERY=1
mkdir -p "$FAKE_STATE_DIR"
if query_failure_output="$(run_demo 2>&1)"; then
  echo "The demo unexpectedly treated a failed commitment query as empty." >&2
  exit 1
fi
grep -qF "simulated commitment query failure" <<<"$query_failure_output"
if grep -qF "tx ft-transfer" "$FAKE_HERMES_LOG"; then
  echo "The demo submitted a transfer after its baseline query failed." >&2
  exit 1
fi

echo "Cosmos compatibility demo orchestration tests passed."
