#!/bin/sh

set -eu

SIMD_HOME="${SIMD_HOME:-/var/lib/simd}"
PROFILE="${COSMOS_PROFILE:?COSMOS_PROFILE is required}"
IBC_SEMANTICS="${COSMOS_IBC_SEMANTICS:?COSMOS_IBC_SEMANTICS is required}"
CHAIN_ID="${COSMOS_CHAIN_ID:?COSMOS_CHAIN_ID is required}"
MONIKER="${COSMOS_MONIKER:-cardano-ibc-${PROFILE}}"
VALIDATOR_MNEMONIC="${COSMOS_VALIDATOR_MNEMONIC:?COSMOS_VALIDATOR_MNEMONIC is required}"
RELAYER_MNEMONIC="${COSMOS_RELAYER_MNEMONIC:?COSMOS_RELAYER_MNEMONIC is required}"
DEMO_MNEMONIC="${COSMOS_DEMO_MNEMONIC:?COSMOS_DEMO_MNEMONIC is required}"
GENESIS_ACCOUNT_BALANCE="${COSMOS_GENESIS_ACCOUNT_BALANCE:-100000000000stake,100000000000utest}"
GENTX_AMOUNT="${COSMOS_GENTX_AMOUNT:-500000000stake}"
MINIMUM_GAS_PRICES="${COSMOS_MINIMUM_GAS_PRICES:-0.0025stake}"
GENESIS_TIME="${COSMOS_GENESIS_TIME:-2025-12-31T23:59:00Z}"
MAX_TX_BYTES=1048576
GOV_VOTING_PERIOD="${COSMOS_GOV_VOTING_PERIOD:-30s}"
GOV_MAX_DEPOSIT_PERIOD="${COSMOS_GOV_MAX_DEPOSIT_PERIOD:-60s}"

# The generic ibc-go v8/v10 profiles model Injective's current public capacity
# envelope. These are fixed snapshots so dependency defaults cannot silently
# turn the compatibility profiles into unrealistically permissive chains.
# Stock simd has no Injective txfees ante handler, so the 75M per-transaction
# gas ceiling is enforced by the generated Hermes profile rather than genesis.
BLOCK_MAX_BYTES=4194304
BLOCK_MAX_GAS=150000000
EVIDENCE_MAX_AGE_NUM_BLOCKS=100000
EVIDENCE_MAX_AGE_DURATION=172800000000000
EVIDENCE_MAX_BYTES=1048576
STAKING_UNBONDING_TIME=1814400s
STAKING_MAX_VALIDATORS=45
STAKING_MAX_ENTRIES=7
STAKING_HISTORICAL_ENTRIES=10000
RPC_MAX_BODY_BYTES=4000000

GENESIS_FILE="${SIMD_HOME}/config/genesis.json"
CONFIG_FILE="${SIMD_HOME}/config/config.toml"

case "${IBC_SEMANTICS}" in
  classic|v2) ;;
  *)
    echo "[${PROFILE}] Unsupported IBC semantics '${IBC_SEMANTICS}'." >&2
    exit 1
    ;;
esac

recover_key() {
  key_name="$1"
  mnemonic="$2"
  printf '%s\n' "${mnemonic}" | simd keys add "${key_name}" \
    --recover \
    --keyring-backend test \
    --home "${SIMD_HOME}" >/dev/null
}

add_genesis_account() {
  key_name="$1"
  address="$(simd keys show "${key_name}" -a --keyring-backend test --home "${SIMD_HOME}")"
  simd genesis add-genesis-account "${address}" "${GENESIS_ACCOUNT_BALANCE}" \
    --home "${SIMD_HOME}"
}

if [ ! -f "${GENESIS_FILE}" ]; then
  echo "[${PROFILE}] Initializing deterministic ${IBC_SEMANTICS} chain '${CHAIN_ID}'..."
  mkdir -p "${SIMD_HOME}"

  simd init "${MONIKER}" --chain-id "${CHAIN_ID}" --home "${SIMD_HOME}" >/dev/null
  cp /opt/cardano-ibc/cosmos-profile-config/node_key.json \
    "${SIMD_HOME}/config/node_key.json"
  cp /opt/cardano-ibc/cosmos-profile-config/priv_validator_key.json \
    "${SIMD_HOME}/config/priv_validator_key.json"
  chmod 600 \
    "${SIMD_HOME}/config/node_key.json" \
    "${SIMD_HOME}/config/priv_validator_key.json"

  recover_key validator "${VALIDATOR_MNEMONIC}"
  recover_key relayer "${RELAYER_MNEMONIC}"
  recover_key demo "${DEMO_MNEMONIC}"

  add_genesis_account validator
  add_genesis_account relayer
  add_genesis_account demo

  simd genesis gentx validator "${GENTX_AMOUNT}" \
    --chain-id "${CHAIN_ID}" \
    --keyring-backend test \
    --home "${SIMD_HOME}" >/dev/null
  simd genesis collect-gentxs --home "${SIMD_HOME}" >/dev/null

  tmp_genesis="$(mktemp)"
  jq \
    --arg genesis_time "${GENESIS_TIME}" \
    --arg gov_voting_period "${GOV_VOTING_PERIOD}" \
    --arg gov_max_deposit_period "${GOV_MAX_DEPOSIT_PERIOD}" \
    --arg block_max_bytes "${BLOCK_MAX_BYTES}" \
    --arg block_max_gas "${BLOCK_MAX_GAS}" \
    --arg evidence_max_age_num_blocks "${EVIDENCE_MAX_AGE_NUM_BLOCKS}" \
    --arg evidence_max_age_duration "${EVIDENCE_MAX_AGE_DURATION}" \
    --arg evidence_max_bytes "${EVIDENCE_MAX_BYTES}" \
    --arg staking_unbonding_time "${STAKING_UNBONDING_TIME}" \
    --argjson staking_max_validators "${STAKING_MAX_VALIDATORS}" \
    --argjson staking_max_entries "${STAKING_MAX_ENTRIES}" \
    --argjson staking_historical_entries "${STAKING_HISTORICAL_ENTRIES}" \
    '.genesis_time = $genesis_time
      | .consensus.params.block.max_bytes = $block_max_bytes
      | .consensus.params.block.max_gas = $block_max_gas
      | .consensus.params.evidence.max_age_num_blocks = $evidence_max_age_num_blocks
      | .consensus.params.evidence.max_age_duration = $evidence_max_age_duration
      | .consensus.params.evidence.max_bytes = $evidence_max_bytes
      | .app_state.staking.params.unbonding_time = $staking_unbonding_time
      | .app_state.staking.params.max_validators = $staking_max_validators
      | .app_state.staking.params.max_entries = $staking_max_entries
      | .app_state.staking.params.historical_entries = $staking_historical_entries
      | .app_state.ibc.client_genesis.params.allowed_clients = ["07-tendermint", "08-cardano-probabilistic"]
      | .app_state.gov.params.voting_period = $gov_voting_period
      | .app_state.gov.params.max_deposit_period = $gov_max_deposit_period
      | .app_state.bank.denom_metadata = [{
          "description": "Deterministic token for Cardano IBC compatibility tests",
          "denom_units": [
            {"denom": "utest", "exponent": 0, "aliases": []},
            {"denom": "test", "exponent": 6, "aliases": []}
          ],
          "base": "utest",
          "display": "test",
          "name": "IBC Test Token",
          "symbol": "TEST",
          "uri": "",
          "uri_hash": ""
        }]' \
    "${GENESIS_FILE}" > "${tmp_genesis}"
  mv "${tmp_genesis}" "${GENESIS_FILE}"

  simd genesis validate "${GENESIS_FILE}" --home "${SIMD_HOME}"
  echo "[${PROFILE}] Deterministic genesis is ready."
else
  echo "[${PROFILE}] Reusing chain home at ${SIMD_HOME}."
fi

# Reject partially initialized or preserved homes whose consensus/staking
# envelope does not match this profile. Docker restarts must not turn a failed
# genesis patch into a chain running dependency defaults.
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
  '.consensus.params.block.max_bytes == $block_max_bytes
    and .consensus.params.block.max_gas == $block_max_gas
    and .consensus.params.evidence.max_age_num_blocks == $evidence_max_age_num_blocks
    and .consensus.params.evidence.max_age_duration == $evidence_max_age_duration
    and .consensus.params.evidence.max_bytes == $evidence_max_bytes
    and .app_state.staking.params.unbonding_time == $staking_unbonding_time
    and .app_state.staking.params.max_validators == $staking_max_validators
    and .app_state.staking.params.max_entries == $staking_max_entries
    and .app_state.staking.params.historical_entries == $staking_historical_entries' \
  "${GENESIS_FILE}" >/dev/null || {
  echo "[${PROFILE}] Preserved genesis does not match the pinned Injective capacity snapshot; remove the profile state and regenerate it." >&2
  exit 1
}

# Keep the local node and the generated Hermes profile on one explicit limit.
# Hermes uses 1,000,000 bytes, leaving room below this CometBFT ceiling.
sed -i "s/^max_tx_bytes = .*/max_tx_bytes = ${MAX_TX_BYTES}/" "${CONFIG_FILE}"
grep -q "^max_tx_bytes = ${MAX_TX_BYTES}$" "${CONFIG_FILE}" || {
  echo "[${PROFILE}] Could not configure max_tx_bytes in ${CONFIG_FILE}." >&2
  exit 1
}
sed -i "s/^max_body_bytes = .*/max_body_bytes = ${RPC_MAX_BODY_BYTES}/" "${CONFIG_FILE}"
grep -q "^max_body_bytes = ${RPC_MAX_BODY_BYTES}$" "${CONFIG_FILE}" || {
  echo "[${PROFILE}] Could not configure max_body_bytes in ${CONFIG_FILE}." >&2
  exit 1
}

exec simd start \
  --home "${SIMD_HOME}" \
  --rpc.laddr "tcp://0.0.0.0:26657" \
  --grpc.address "0.0.0.0:9090" \
  --api.enable=true \
  --api.address "tcp://0.0.0.0:1317" \
  --api.enabled-unsafe-cors=true \
  --minimum-gas-prices "${MINIMUM_GAS_PRICES}"
