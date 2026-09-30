#!/bin/sh

# Only the disposable v8 fixture can opt into the selected DevKit network's clock.
local_clock_binding() {
  if [ "${COSMOS_LOCAL_CLOCK_MODE:-real}" = devkit ]; then
    jq -n --arg offset "${DEVKIT_CLOCK_OFFSET}" \
      --arg network "${COSMOS_LOCAL_CARDANO_NETWORK_ID}" \
      --arg genesis "${GENESIS_TIME}" \
      '{mode:"devkit", offset:$offset, cardano_network_id:$network, cosmos_genesis_time:$genesis}'
  else
    printf '%s\n' '{"mode":"real"}'
  fi
}

local_clock_reset_error() {
  echo "[${PROFILE}] Retained Cosmos state belongs to another clock or Cardano network. Restart this profile with --chain-flag stateful=false to reset it." >&2
  return 1
}

check_local_clock() {
  image_clock_enabled="$1"
  clock_mode="${COSMOS_LOCAL_CLOCK_MODE:-real}"
  clock_marker="${SIMD_HOME}/.caribic-local-clock.json"
  case "${clock_mode}" in
    real)
      if [ "${image_clock_enabled}" != 0 ] || [ -n "${DEVKIT_CLOCK_OFFSET:-}" ] || [ -n "${COSMOS_LOCAL_CARDANO_NETWORK_ID:-}" ]; then
        echo "[${PROFILE}] Real-clock mode requires the normal fixture image and no DevKit clock settings." >&2
        return 1
      fi
      ;;
    devkit)
      if [ "${PROFILE}" != v8-classic ] || [ "${CHAIN_ID}" != v8-classic-1 ] || [ "${image_clock_enabled}" != 1 ]; then
        echo "[${PROFILE}] The DevKit clock requires the clock-enabled local v8-classic fixture image." >&2
        return 1
      fi
      if ! printf '%s\n' "${DEVKIT_CLOCK_OFFSET:-}" | grep -Eq '^[+-](0|[1-9][0-9]*)s$' || [ -z "${COSMOS_LOCAL_CARDANO_NETWORK_ID:-}" ]; then
        echo "[${PROFILE}] The persisted DevKit offset and Cardano network instance are required." >&2
        return 1
      fi
      genesis_seconds="$(jq -nr --arg value "${GENESIS_TIME}" '$value | fromdateiso8601')" || return 1
      offset_seconds="${DEVKIT_CLOCK_OFFSET%s}"
      if [ "${genesis_seconds}" -ge "$(( $(date -u +%s) + offset_seconds ))" ]; then
        echo "[${PROFILE}] Cosmos genesis must precede the synchronized DevKit clock." >&2
        return 1
      fi
      ;;
    *)
      echo "[${PROFILE}] Unsupported local clock mode '${clock_mode}'." >&2
      return 1
      ;;
  esac

  if [ -f "${clock_marker}" ]; then
    expected_clock="$(local_clock_binding)" || return 1
    jq -e --argjson expected "${expected_clock}" '. == $expected' "${clock_marker}" >/dev/null 2>&1 || {
      local_clock_reset_error
      return 1
    }
  elif [ -f "${GENESIS_FILE}" ] && [ "${clock_mode}" = devkit ]; then
    local_clock_reset_error
    return 1
  fi
  if [ -f "${GENESIS_FILE}" ] && [ "${clock_mode}" = devkit ]; then
    jq -e --arg genesis "${GENESIS_TIME}" --arg chain "${CHAIN_ID}" \
      '.genesis_time == $genesis and .chain_id == $chain' "${GENESIS_FILE}" >/dev/null || {
      local_clock_reset_error
      return 1
    }
  fi
}

record_local_clock() {
  clock_temporary="$(mktemp "${SIMD_HOME}/.caribic-local-clock.XXXXXX")" || return 1
  local_clock_binding > "${clock_temporary}" || return 1
  chmod 644 "${clock_temporary}"
  mv "${clock_temporary}" "${SIMD_HOME}/.caribic-local-clock.json"
}
