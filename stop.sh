#!/bin/bash

#please check the directory settings before running
CARDANO_SCRIPT_DIR="cardano/scripts"
COSMOS_SCRIPT_DIR="cosmos/scripts"
RELAYER_SCRIPT_DIR="relayer/scripts"
OSMOSIS_SCRIPT_DIR="chains/osmosis/osmosis/scripts"

SCRIPT_DIR=$(dirname $(realpath $0))

title="IBC project Cardano with Cosmos"

title_length=${#title}
echo "╔$(printf '═%.0s' $(seq 1 $((title_length + 2))))╗"
echo "║$(printf ' %.0s' $(seq 1 $((($title_length - ${#title}) / 2))))$title$(printf ' %.0s' $(seq 1 $((($title_length - ${#title}) / 2))))║"
echo "╚$(printf '═%.0s' $(seq 1 $((title_length + 2))))╝"

set_permission() {
  chmod +x ${SCRIPT_DIR}/${CARDANO_SCRIPT_DIR}/stop.sh || return 1
  chmod +x ${SCRIPT_DIR}/${COSMOS_SCRIPT_DIR}/stop.sh || return 1
  chmod +x ${SCRIPT_DIR}/${RELAYER_SCRIPT_DIR}/stop.sh || return 1
  chmod +x ${SCRIPT_DIR}/${OSMOSIS_SCRIPT_DIR}/stop.sh || return 1
  return 0
}

run() {
    bash ${SCRIPT_DIR}/${CARDANO_SCRIPT_DIR}/stop.sh && \
    bash ${SCRIPT_DIR}/${COSMOS_SCRIPT_DIR}/stop.sh &&
    bash ${SCRIPT_DIR}/${OSMOSIS_SCRIPT_DIR}/stop.sh &&
    bash ${SCRIPT_DIR}/${RELAYER_SCRIPT_DIR}/stop.sh || return 1
  return 0
}

if set_permission; then
    echo >&2 -e "\nSet permission successful!";
else
    echo >&2 -e "\nWARNING: Fails to set permission for the files.";
fi

if ! run; then
  echo >&2 -e "\nFails to Stop!!!"
else
  echo >&2 -e "\nSystem stop completed! Run start.sh if you want to start the system."
fi