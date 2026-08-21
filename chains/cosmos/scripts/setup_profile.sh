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

GENESIS_FILE="${SIMD_HOME}/config/genesis.json"

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
    '.genesis_time = $genesis_time
      | .consensus.params.block.max_gas = "100000000"
      | .app_state.ibc.client_genesis.params.allowed_clients = ["07-tendermint", "08-cardano-probabilistic"]
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

exec simd start \
  --home "${SIMD_HOME}" \
  --rpc.laddr "tcp://0.0.0.0:26657" \
  --grpc.address "0.0.0.0:9090" \
  --api.enable=true \
  --api.address "tcp://0.0.0.0:1317" \
  --api.enabled-unsafe-cors=true \
  --minimum-gas-prices "${MINIMUM_GAS_PRICES}"
