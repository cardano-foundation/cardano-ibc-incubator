#!/bin/sh

set -eu

INJECTIVE_HOME="${INJECTIVE_HOME:-$HOME/.injectived}"
CHAIN_ID="${INJECTIVE_LOCAL_CHAIN_ID:-injective-777}"
MONIKER="${INJECTIVE_LOCAL_MONIKER:-caribic-injective-local}"
VALIDATOR_KEY="${INJECTIVE_LOCAL_VALIDATOR_KEY:-validator}"
VALIDATOR_MNEMONIC="${INJECTIVE_LOCAL_VALIDATOR_MNEMONIC:-bottom loan skill merry east cradle onion journey palm apology verb edit desert impose absurd oil bubble sweet glove shallow size build burst effort}"
GENESIS_ACCOUNT_AMOUNT="${INJECTIVE_LOCAL_GENESIS_ACCOUNT_AMOUNT:-100000000000000000000stake}"
GENTX_AMOUNT="${INJECTIVE_LOCAL_GENTX_AMOUNT:-50000000000000000000stake}"
MIN_GAS_PRICES="${INJECTIVE_LOCAL_MIN_GAS_PRICES:-0.025inj}"

GENESIS_FILE="${INJECTIVE_HOME}/config/genesis.json"
APP_TOML_FILE="${INJECTIVE_HOME}/config/app.toml"

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
  injectived genesis validate --home "${INJECTIVE_HOME}"
else
  echo "[injective-local] Reusing existing chain home at ${INJECTIVE_HOME}."
fi

if [ -f "${APP_TOML_FILE}" ]; then
  if grep -q '^[[:space:]]*minimum-gas-prices[[:space:]]*=' "${APP_TOML_FILE}"; then
    sed -i "s|^[[:space:]]*minimum-gas-prices[[:space:]]*=.*$|minimum-gas-prices = \"${MIN_GAS_PRICES}\"|g" "${APP_TOML_FILE}"
  else
    printf '\nminimum-gas-prices = "%s"\n' "${MIN_GAS_PRICES}" >> "${APP_TOML_FILE}"
  fi
  echo "[injective-local] Set app minimum-gas-prices to ${MIN_GAS_PRICES}."
fi

exec injectived start \
  --home "${INJECTIVE_HOME}" \
  --rpc.laddr "tcp://0.0.0.0:26657" \
  --grpc.address "0.0.0.0:9090" \
  --api.address "tcp://0.0.0.0:1317" \
  --minimum-gas-prices "${MIN_GAS_PRICES}"
