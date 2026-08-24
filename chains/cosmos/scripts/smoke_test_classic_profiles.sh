#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(dirname "$(realpath "$0")")"
repo_root="$(realpath "$script_dir/../../..")"
compose_file="$repo_root/chains/cosmos/docker-compose.yml"
project_name="cardano-ibc-cosmos-classic-smoke-$$"
state_root="$(mktemp -d "$repo_root/.cosmos-classic-smoke.XXXXXX")"

relayer_address="cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt"
demo_address="cosmos1eqt75k80sh3wcqzkr07k0ynyydc50932sc8uxf"
node_id="d2579f2590308e55ffcbf68b563438ce8100f37b"

cleanup() {
  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile v8-classic \
    --profile v10-classic \
    down --remove-orphans >/dev/null 2>&1 || true

  case "$state_root" in
    "$repo_root"/.cosmos-classic-smoke.*)
      rm -rf -- "$state_root"
      ;;
  esac
}
trap cleanup EXIT INT TERM

profile_value() {
  local profile="$1"
  local field="$2"

  case "$profile:$field" in
    v8-classic:chain_id) echo "v8-classic-1" ;;
    v8-classic:rpc_port) echo "26757" ;;
    v8-classic:grpc_port) echo "9100" ;;
    v8-classic:rest_port) echo "1327" ;;
    v8-classic:commit) echo "53eaba19375dab0145509af101dbce193284ec5d" ;;
    v8-classic:go_prefix) echo "go version go1.21" ;;
    v10-classic:chain_id) echo "v10-classic-1" ;;
    v10-classic:rpc_port) echo "26857" ;;
    v10-classic:grpc_port) echo "9110" ;;
    v10-classic:rest_port) echo "1338" ;;
    v10-classic:commit) echo "e120ef5d4778c3e659ce57b59f028b250be5bb2e" ;;
    v10-classic:go_prefix) echo "go version go1.23.8" ;;
    *)
      echo "Unknown profile field: $profile/$field" >&2
      return 1
      ;;
  esac
}

wait_for_rpc() {
  local profile="$1"
  local rpc_port="$2"
  local expected_chain_id="$3"

  for _ in $(seq 1 60); do
    if status="$(curl --max-time 2 -fsS "http://127.0.0.1:${rpc_port}/status" 2>/dev/null)"; then
      if jq -e --arg chain_id "$expected_chain_id" \
        --arg node_id "$node_id" \
        '.result.node_info.network == $chain_id
          and .result.node_info.id == $node_id
          and (.result.sync_info.latest_block_height | tonumber) > 0' \
        >/dev/null <<<"$status"; then
        return 0
      fi
    fi
    sleep 2
  done

  docker compose -p "$project_name" -f "$compose_file" \
    --profile "$profile" logs --tail 120 "$profile" >&2 || true
  return 1
}

assert_funded_account() {
  local profile="$1"
  local address="$2"
  local balances
  balances="$(docker compose -p "$project_name" -f "$compose_file" \
    --profile "$profile" exec -T "$profile" \
    simd query bank balances "$address" --home /var/lib/simd -o json)"

  jq -e '
    any(.balances[]; .denom == "stake" and .amount == "100000000000")
      and any(.balances[]; .denom == "utest" and .amount == "100000000000")
  ' >/dev/null <<<"$balances"
}

test_profile() {
  local profile="$1"
  local chain_id rpc_port grpc_port rest_port expected_commit expected_go_prefix
  chain_id="$(profile_value "$profile" chain_id)"
  rpc_port="$(profile_value "$profile" rpc_port)"
  grpc_port="$(profile_value "$profile" grpc_port)"
  rest_port="$(profile_value "$profile" rest_port)"
  expected_commit="$(profile_value "$profile" commit)"
  expected_go_prefix="$(profile_value "$profile" go_prefix)"

  mkdir -p "$state_root/$profile"
  echo "Building and starting $profile from clean deterministic state..."
  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile "$profile" \
    up --build -d "$profile"

  wait_for_rpc "$profile" "$rpc_port" "$chain_id"

  local client_params
  client_params="$(docker compose -p "$project_name" -f "$compose_file" \
    --profile "$profile" exec -T "$profile" \
    simd query ibc client params --home /var/lib/simd -o json)"
  jq -e '
    (.allowed_clients | index("07-tendermint")) != null
      and (.allowed_clients | index("08-cardano-probabilistic")) != null
  ' >/dev/null <<<"$client_params"

  local governance_params
  governance_params="$(docker compose -p "$project_name" -f "$compose_file" \
    --profile "$profile" exec -T "$profile" \
    jq -c '.app_state.gov.params' /var/lib/simd/config/genesis.json)"
  jq -e '
    .voting_period == "30s"
      and .max_deposit_period == "60s"
  ' >/dev/null <<<"$governance_params"

  assert_funded_account "$profile" "$relayer_address"
  assert_funded_account "$profile" "$demo_address"

  local node_info
  node_info="$(curl --max-time 5 -fsS \
    "http://127.0.0.1:${rest_port}/cosmos/base/tendermint/v1beta1/node_info")"
  jq -e \
    --arg chain_id "$chain_id" \
    --arg commit "$expected_commit" \
    --arg go_prefix "$expected_go_prefix" \
    '.default_node_info.network == $chain_id
      and .application_version.git_commit == $commit
      and (.application_version.go_version | startswith($go_prefix))' \
    >/dev/null <<<"$node_info"

  if ! (exec 3<>"/dev/tcp/127.0.0.1/${grpc_port}") 2>/dev/null; then
    echo "$profile gRPC port $grpc_port is not accepting connections" >&2
    return 1
  fi

  local first_genesis_hash second_genesis_hash
  first_genesis_hash="$(docker compose -p "$project_name" -f "$compose_file" \
    --profile "$profile" exec -T "$profile" \
    sha256sum /var/lib/simd/config/genesis.json | awk '{print $1}')"

  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile "$profile" \
    stop "$profile" >/dev/null
  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile "$profile" \
    rm -f "$profile" >/dev/null
  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile "$profile" \
    run --rm --no-deps --entrypoint sh "$profile" \
    -c 'find /var/lib/simd -mindepth 1 -depth -delete' >/dev/null
  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile "$profile" \
    up --no-build -d "$profile" >/dev/null

  wait_for_rpc "$profile" "$rpc_port" "$chain_id"
  second_genesis_hash="$(docker compose -p "$project_name" -f "$compose_file" \
    --profile "$profile" exec -T "$profile" \
    sha256sum /var/lib/simd/config/genesis.json | awk '{print $1}')"

  if [[ "$first_genesis_hash" != "$second_genesis_hash" ]]; then
    echo "$profile genesis is not reproducible across clean starts" >&2
    echo "first:  $first_genesis_hash" >&2
    echo "second: $second_genesis_hash" >&2
    return 1
  fi

  echo "PASS: $profile deterministic Classic profile ($first_genesis_hash)"
  COSMOS_PROFILES_STATE_DIR="$state_root" docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    --profile "$profile" \
    stop "$profile" >/dev/null
}

test_profile v8-classic
test_profile v10-classic

echo "PASS: Classic profile smoke tests completed. v10-v2 semantics remain intentionally deferred."
