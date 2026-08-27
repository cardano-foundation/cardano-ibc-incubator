#!/bin/sh

set -eu

INJECTIVE_HOME="${INJECTIVE_HOME:-$HOME/.injectived}"
CHAIN_ID="${INJECTIVE_LOCAL_CHAIN_ID:-injective-777}"
MONIKER="${INJECTIVE_LOCAL_MONIKER:-caribic-injective-local}"
VALIDATOR_KEY="${INJECTIVE_LOCAL_VALIDATOR_KEY:-validator}"
VALIDATOR_MNEMONIC="${INJECTIVE_LOCAL_VALIDATOR_MNEMONIC:-}"
GENESIS_ACCOUNT_AMOUNT="${INJECTIVE_LOCAL_GENESIS_ACCOUNT_AMOUNT:-100000000000000000000stake}"
GENTX_AMOUNT="${INJECTIVE_LOCAL_GENTX_AMOUNT:-50000000000000000000stake}"
MIN_GAS_PRICES="${INJECTIVE_LOCAL_MIN_GAS_PRICES:-0.025inj}"
LOCAL_GENESIS_TIME="${INJECTIVE_LOCAL_GENESIS_TIME:-2025-12-31T23:59:00Z}"

# Injective mainnet capacity snapshot, observed 2026-08-27. Local fee prices
# remain synthetic, but consensus, staking and per-transaction ceilings match
# the public chain.
BLOCK_MAX_BYTES=4194304
BLOCK_MAX_GAS=150000000
EVIDENCE_MAX_AGE_NUM_BLOCKS=100000
EVIDENCE_MAX_AGE_DURATION=172800000000000
EVIDENCE_MAX_BYTES=1048576
STAKING_UNBONDING_TIME=1814400s
STAKING_MAX_VALIDATORS=45
STAKING_MAX_ENTRIES=7
STAKING_HISTORICAL_ENTRIES=10000
MAX_GAS_WANTED_PER_TX=75000000
MEMPOOL_MAX_TX_BYTES=1048576
RPC_MAX_BODY_BYTES=4000000

GENESIS_FILE="${INJECTIVE_HOME}/config/genesis.json"
APP_TOML_FILE="${INJECTIVE_HOME}/config/app.toml"
CONFIG_TOML_FILE="${INJECTIVE_HOME}/config/config.toml"

if [ ! -f "${GENESIS_FILE}" ]; then
  echo "[injective-local] Initializing local chain home at ${INJECTIVE_HOME}..."

  mkdir -p "${INJECTIVE_HOME}"
  find "${INJECTIVE_HOME}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

  injectived init "${MONIKER}" --chain-id "${CHAIN_ID}" --home "${INJECTIVE_HOME}"

  if [ -z "${VALIDATOR_MNEMONIC}" ]; then
    echo "[injective-local] Validator mnemonic is empty"
    exit 1
  fi
  echo "${VALIDATOR_MNEMONIC}" | injectived keys add "${VALIDATOR_KEY}" --recover --keyring-backend test --home "${INJECTIVE_HOME}"
  VALIDATOR_ADDRESS="$(injectived keys show "${VALIDATOR_KEY}" -a --keyring-backend test --home "${INJECTIVE_HOME}")"

  injectived genesis add-genesis-account \
    "${VALIDATOR_ADDRESS}" \
    "${GENESIS_ACCOUNT_AMOUNT}" \
    --chain-id "${CHAIN_ID}" \
    --home "${INJECTIVE_HOME}"

  injectived genesis gentx \
    "${VALIDATOR_KEY}" \
    "${GENTX_AMOUNT}" \
    --chain-id "${CHAIN_ID}" \
    --keyring-backend test \
    --home "${INJECTIVE_HOME}"

  injectived genesis collect-gentxs --home "${INJECTIVE_HOME}"
  tmp_genesis="$(mktemp)"
  jq \
    --arg max_bytes "${BLOCK_MAX_BYTES}" \
    --arg max_gas "${BLOCK_MAX_GAS}" \
    --arg evidence_max_age_num_blocks "${EVIDENCE_MAX_AGE_NUM_BLOCKS}" \
    --arg evidence_max_age_duration "${EVIDENCE_MAX_AGE_DURATION}" \
    --arg evidence_max_bytes "${EVIDENCE_MAX_BYTES}" \
    --arg staking_unbonding_time "${STAKING_UNBONDING_TIME}" \
    --argjson staking_max_validators "${STAKING_MAX_VALIDATORS}" \
    --argjson staking_max_entries "${STAKING_MAX_ENTRIES}" \
    --argjson staking_historical_entries "${STAKING_HISTORICAL_ENTRIES}" \
    --arg max_gas_wanted_per_tx "${MAX_GAS_WANTED_PER_TX}" \
    --arg genesis_time "${LOCAL_GENESIS_TIME}" \
    '.consensus.params.block.max_bytes = $max_bytes
      | .consensus.params.block.max_gas = $max_gas
      | .consensus.params.evidence.max_age_num_blocks = $evidence_max_age_num_blocks
      | .consensus.params.evidence.max_age_duration = $evidence_max_age_duration
      | .consensus.params.evidence.max_bytes = $evidence_max_bytes
      | .app_state.staking.params.unbonding_time = $staking_unbonding_time
      | .app_state.staking.params.max_validators = $staking_max_validators
      | .app_state.staking.params.max_entries = $staking_max_entries
      | .app_state.staking.params.historical_entries = $staking_historical_entries
      | if (.app_state.txfees.params? | type) == "object"
        then .app_state.txfees.params.max_gas_wanted_per_tx = $max_gas_wanted_per_tx
        else error("Injective genesis is missing app_state.txfees.params") end
      | .genesis_time = $genesis_time' \
    "${GENESIS_FILE}" > "${tmp_genesis}"
  mv "${tmp_genesis}" "${GENESIS_FILE}"
  echo "[injective-local] Applied the Injective mainnet capacity snapshot."
  echo "[injective-local] Set genesis_time to ${LOCAL_GENESIS_TIME}."
  injectived genesis validate --home "${INJECTIVE_HOME}"
else
  echo "[injective-local] Reusing existing chain home at ${INJECTIVE_HOME}."
fi

# Assert the full snapshot on every start. This also fails closed if init wrote
# a default genesis before a prior patch attempt failed and Docker restarted
# the container, or if an operator reuses state created with older limits.
jq -e \
  --arg block_max_bytes "${BLOCK_MAX_BYTES}" \
  --arg block_max_gas "${BLOCK_MAX_GAS}" \
  --arg evidence_max_age_num_blocks "${EVIDENCE_MAX_AGE_NUM_BLOCKS}" \
  --arg evidence_max_age_duration "${EVIDENCE_MAX_AGE_DURATION}" \
  --arg evidence_max_bytes "${EVIDENCE_MAX_BYTES}" \
  --arg staking_unbonding_time "${STAKING_UNBONDING_TIME}" \
  --argjson staking_max_validators "${STAKING_MAX_VALIDATORS}" \
  --argjson staking_max_entries "${STAKING_MAX_ENTRIES}" \
  --argjson staking_historical_entries "${STAKING_HISTORICAL_ENTRIES}" \
  --arg max_gas_wanted_per_tx "${MAX_GAS_WANTED_PER_TX}" \
  '.consensus.params.block.max_bytes == $block_max_bytes
    and .consensus.params.block.max_gas == $block_max_gas
    and .consensus.params.evidence.max_age_num_blocks == $evidence_max_age_num_blocks
    and .consensus.params.evidence.max_age_duration == $evidence_max_age_duration
    and .consensus.params.evidence.max_bytes == $evidence_max_bytes
    and .app_state.staking.params.unbonding_time == $staking_unbonding_time
    and .app_state.staking.params.max_validators == $staking_max_validators
    and .app_state.staking.params.max_entries == $staking_max_entries
    and .app_state.staking.params.historical_entries == $staking_historical_entries
    and .app_state.txfees.params.max_gas_wanted_per_tx == $max_gas_wanted_per_tx' \
  "${GENESIS_FILE}" >/dev/null || {
  echo "[injective-local] Preserved genesis does not match the pinned Injective mainnet capacity snapshot; remove the local chain state and regenerate it." >&2
  exit 1
}

if [ ! -f "${CONFIG_TOML_FILE}" ]; then
  echo "[injective-local] Missing required ${CONFIG_TOML_FILE}." >&2
  exit 1
fi
sed -i "s/^max_tx_bytes = .*/max_tx_bytes = ${MEMPOOL_MAX_TX_BYTES}/" "${CONFIG_TOML_FILE}"
grep -q "^max_tx_bytes = ${MEMPOOL_MAX_TX_BYTES}$" "${CONFIG_TOML_FILE}" || {
  echo "[injective-local] Could not configure max_tx_bytes in ${CONFIG_TOML_FILE}." >&2
  exit 1
}
sed -i "s/^max_body_bytes = .*/max_body_bytes = ${RPC_MAX_BODY_BYTES}/" "${CONFIG_TOML_FILE}"
grep -q "^max_body_bytes = ${RPC_MAX_BODY_BYTES}$" "${CONFIG_TOML_FILE}" || {
  echo "[injective-local] Could not configure max_body_bytes in ${CONFIG_TOML_FILE}." >&2
  exit 1
}

if [ ! -f "${APP_TOML_FILE}" ]; then
  echo "[injective-local] Missing required ${APP_TOML_FILE}." >&2
  exit 1
fi
sed -i "s/^rpc-max-body-bytes = .*/rpc-max-body-bytes = ${RPC_MAX_BODY_BYTES}/" "${APP_TOML_FILE}"
grep -q "^rpc-max-body-bytes = ${RPC_MAX_BODY_BYTES}$" "${APP_TOML_FILE}" || {
  echo "[injective-local] Could not configure rpc-max-body-bytes in ${APP_TOML_FILE}." >&2
  exit 1
}
if grep -q '^[[:space:]]*minimum-gas-prices[[:space:]]*=' "${APP_TOML_FILE}"; then
  sed -i "s|^[[:space:]]*minimum-gas-prices[[:space:]]*=.*$|minimum-gas-prices = \"${MIN_GAS_PRICES}\"|g" "${APP_TOML_FILE}"
else
  printf '\nminimum-gas-prices = "%s"\n' "${MIN_GAS_PRICES}" >> "${APP_TOML_FILE}"
fi
echo "[injective-local] Set app minimum-gas-prices to ${MIN_GAS_PRICES}."

exec injectived start \
  --home "${INJECTIVE_HOME}" \
  --rpc.laddr "tcp://0.0.0.0:26657" \
  --grpc.address "0.0.0.0:9090" \
  --api.address "tcp://0.0.0.0:1317" \
  --minimum-gas-prices "${MIN_GAS_PRICES}"
