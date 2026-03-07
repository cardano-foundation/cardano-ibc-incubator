#!/usr/bin/env bash

set -euo pipefail

INJECTIVE_HOME="${INJECTIVE_HOME:-$HOME/.injectived}"
CHAIN_ID="${INJECTIVE_TESTNET_CHAIN_ID:-injective-888}"
MONIKER="${INJECTIVE_TESTNET_MONIKER:-caribic-injective-testnet}"
GENESIS_URL="${INJECTIVE_TESTNET_GENESIS_URL:-https://injective-snapshots.s3.amazonaws.com/testnet/genesis.json}"
MIN_GAS_PRICES="${INJECTIVE_TESTNET_MIN_GAS_PRICES:-0.025inj}"
BOOTSTRAP_MODE="${INJECTIVE_TESTNET_BOOTSTRAP_MODE:-snapshot}"
SNAPSHOT_URL="${INJECTIVE_TESTNET_SNAPSHOT_URL:-}"
SNAPSHOT_PAGE_URL="${INJECTIVE_TESTNET_SNAPSHOT_PAGE_URL:-https://www.polkachu.com/testnets/injective/snapshots}"
P2P_SEEDS="${INJECTIVED_P2P_SEEDS:-}"
P2P_PERSISTENT_PEERS="${INJECTIVED_P2P_PERSISTENT_PEERS:-}"

GENESIS_FILE="${INJECTIVE_HOME}/config/genesis.json"
CONFIG_TOML_FILE="${INJECTIVE_HOME}/config/config.toml"
APP_TOML_FILE="${INJECTIVE_HOME}/config/app.toml"
SNAPSHOT_MARKER_FILE="${INJECTIVE_HOME}/.caribic_snapshot_restored"

download_to_file() {
  url="$1"
  destination_file="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 5 --retry-all-errors --connect-timeout 10 "$url" -o "$destination_file"
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination_file" "$url"
    return 0
  fi

  echo "[injective-testnet] Neither curl nor wget is available to download: $url"
  exit 1
}

download_snapshot_to_file() {
  url="$1"
  destination_file="$2"

  # Download snapshots to a real file first so retries do not corrupt a streamed tar pipeline.
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 5 --retry-all-errors --connect-timeout 10 \
      -o "$destination_file" "$url"
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination_file" "$url"
    return 0
  fi

  echo "[injective-testnet] Neither curl nor wget is available to download snapshot: $url"
  exit 1
}

download_to_stdout() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 5 --retry-all-errors --connect-timeout 10 "$url"
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
    return 0
  fi

  echo "[injective-testnet] Neither curl nor wget is available to stream download: $url"
  exit 1
}

download_genesis() {
  echo "[injective-testnet] Downloading genesis from ${GENESIS_URL} ..."
  download_to_file "${GENESIS_URL}" "${GENESIS_FILE}"
}

resolve_snapshot_url() {
  if [ -n "${SNAPSHOT_URL}" ]; then
    printf '%s' "${SNAPSHOT_URL}"
    return 0
  fi

  if [ -z "${SNAPSHOT_PAGE_URL}" ]; then
    echo "[injective-testnet] Snapshot URL is empty and snapshot page URL was not provided." >&2
    return 1
  fi

  echo "[injective-testnet] Resolving latest snapshot URL from ${SNAPSHOT_PAGE_URL} ..." >&2
  page_content="$(download_to_stdout "${SNAPSHOT_PAGE_URL}" 2>/dev/null || true)"
  if [ -z "${page_content}" ]; then
    echo "[injective-testnet] Failed to fetch snapshot page: ${SNAPSHOT_PAGE_URL}" >&2
    return 1
  fi

  latest_snapshot_url="$(
    printf '%s' "${page_content}" \
      | grep -Eo 'https://snapshots\.polkachu\.com/testnet-snapshots/injective/injective_[0-9]+\.tar\.lz4' \
      | head -n 1
  )"
  if [ -z "${latest_snapshot_url}" ]; then
    echo "[injective-testnet] Unable to resolve Injective testnet snapshot URL from: ${SNAPSHOT_PAGE_URL}" >&2
    return 1
  fi

  printf '%s' "${latest_snapshot_url}"
}

restore_snapshot() {
  snapshot_url="$1"

  if ! command -v lz4 >/dev/null 2>&1; then
    echo "[injective-testnet] Snapshot bootstrap requires lz4, but it is not available in this container image."
    exit 1
  fi

  echo "[injective-testnet] Restoring snapshot from ${snapshot_url} ..."

  injectived tendermint unsafe-reset-all --home "${INJECTIVE_HOME}" --keep-addr-book >/dev/null 2>&1 || true
  rm -rf "${INJECTIVE_HOME}/data" "${INJECTIVE_HOME}/wasm"
  mkdir -p "${INJECTIVE_HOME}"

  snapshot_archive_file="${INJECTIVE_HOME}/.caribic_injective_snapshot.tar.lz4"
  rm -f "${snapshot_archive_file}"
  echo "[injective-testnet] Downloading snapshot archive to ${snapshot_archive_file} ..."
  download_snapshot_to_file "${snapshot_url}" "${snapshot_archive_file}"

  if ! lz4 -d "${snapshot_archive_file}" - | tar -x -C "${INJECTIVE_HOME}"; then
    rm -f "${snapshot_archive_file}"
    echo "[injective-testnet] Snapshot bootstrap failed while downloading/decompressing/extracting."
    exit 1
  fi
  rm -f "${snapshot_archive_file}"

  # Some providers package files under an "injectived/" root directory.
  if [ -d "${INJECTIVE_HOME}/injectived" ] && [ ! -d "${INJECTIVE_HOME}/data" ]; then
    cp -a "${INJECTIVE_HOME}/injectived/." "${INJECTIVE_HOME}/"
    rm -rf "${INJECTIVE_HOME}/injectived"
  fi

  if [ ! -d "${INJECTIVE_HOME}/data" ]; then
    echo "[injective-testnet] Snapshot restore completed but ${INJECTIVE_HOME}/data is missing."
    exit 1
  fi

  if [ ! -d "${INJECTIVE_HOME}/wasm" ]; then
    echo "[injective-testnet] Snapshot restore completed without wasm directory; creating empty wasm dir."
    mkdir -p "${INJECTIVE_HOME}/wasm"
  fi

  printf 'snapshot_url=%s\n' "${snapshot_url}" > "${SNAPSHOT_MARKER_FILE}"
  printf '%s\n' "${snapshot_url}" > "${INJECTIVE_HOME}/.caribic_snapshot_source"
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'
}

set_config_string() {
  section="$1"
  key="$2"
  value="$3"
  file="$4"
  escaped_value="$(escape_sed_replacement "$value")"
  sed -i "/^\\[$section\\]/,/^\\[/{s|^[[:space:]]*$key[[:space:]]*=.*|$key = \"$escaped_value\"|;}" "$file"
}

set_config_raw() {
  section="$1"
  key="$2"
  value="$3"
  file="$4"
  escaped_value="$(escape_sed_replacement "$value")"
  sed -i "/^\\[$section\\]/,/^\\[/{s|^[[:space:]]*$key[[:space:]]*=.*|$key = $escaped_value|;}" "$file"
}

bootstrapped_fresh_home="false"
if [ ! -f "${GENESIS_FILE}" ]; then
  echo "[injective-testnet] Initializing testnet home at ${INJECTIVE_HOME}..."

  mkdir -p "${INJECTIVE_HOME}"
  find "${INJECTIVE_HOME}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

  injectived init "${MONIKER}" --chain-id "${CHAIN_ID}" --home "${INJECTIVE_HOME}"
  download_genesis
  bootstrapped_fresh_home="true"
else
  echo "[injective-testnet] Reusing existing testnet home at ${INJECTIVE_HOME}."
fi

needs_snapshot_restore="false"
if [ "${BOOTSTRAP_MODE}" = "snapshot" ]; then
  if [ "${bootstrapped_fresh_home}" = "true" ]; then
    needs_snapshot_restore="true"
  elif [ ! -f "${SNAPSHOT_MARKER_FILE}" ]; then
    needs_snapshot_restore="true"
  elif [ ! -d "${INJECTIVE_HOME}/data/application.db" ]; then
    needs_snapshot_restore="true"
  elif [ ! -d "${INJECTIVE_HOME}/wasm" ]; then
    needs_snapshot_restore="true"
  fi

  if [ "${needs_snapshot_restore}" = "true" ]; then
    resolved_snapshot_url="$(resolve_snapshot_url)"
    if [ -z "${resolved_snapshot_url}" ]; then
      echo "[injective-testnet] Snapshot bootstrap mode is enabled but no snapshot URL could be resolved."
      exit 1
    fi
    restore_snapshot "${resolved_snapshot_url}"
  else
    echo "[injective-testnet] Snapshot bootstrap skipped because existing data and wasm directories are present."
  fi
elif [ "${BOOTSTRAP_MODE}" = "none" ]; then
  echo "[injective-testnet] Snapshot bootstrap disabled; node will sync from current local state/genesis."
else
  echo "[injective-testnet] Unsupported INJECTIVE_TESTNET_BOOTSTRAP_MODE='${BOOTSTRAP_MODE}'. Expected 'snapshot' or 'none'."
  exit 1
fi

if [ -f "${CONFIG_TOML_FILE}" ]; then
  set_config_raw "statesync" "enable" "false" "${CONFIG_TOML_FILE}"
  set_config_string "statesync" "rpc_servers" "" "${CONFIG_TOML_FILE}"
  set_config_raw "statesync" "trust_height" "0" "${CONFIG_TOML_FILE}"
  set_config_string "statesync" "trust_hash" "" "${CONFIG_TOML_FILE}"

  if [ -n "${P2P_SEEDS}" ]; then
    set_config_string "p2p" "seeds" "${P2P_SEEDS}" "${CONFIG_TOML_FILE}"
  fi
  if [ -n "${P2P_PERSISTENT_PEERS}" ]; then
    set_config_string "p2p" "persistent_peers" "${P2P_PERSISTENT_PEERS}" "${CONFIG_TOML_FILE}"
  fi
fi

if [ -f "${APP_TOML_FILE}" ]; then
  if grep -q '^[[:space:]]*minimum-gas-prices[[:space:]]*=' "${APP_TOML_FILE}"; then
    sed -i "s|^[[:space:]]*minimum-gas-prices[[:space:]]*=.*$|minimum-gas-prices = \"${MIN_GAS_PRICES}\"|g" "${APP_TOML_FILE}"
  else
    printf '\nminimum-gas-prices = "%s"\n' "${MIN_GAS_PRICES}" >> "${APP_TOML_FILE}"
  fi
fi

exec injectived start \
  --home "${INJECTIVE_HOME}" \
  --rpc.laddr "tcp://0.0.0.0:26657" \
  --grpc.address "0.0.0.0:9090" \
  --api.address "tcp://0.0.0.0:1317" \
  --minimum-gas-prices "${MIN_GAS_PRICES}"
