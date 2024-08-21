#!/bin/bash

#please check the directory settings before running
CARDANO_SCRIPT_DIR="cardano/scripts"
COSMOS_SCRIPT_DIR="cosmos/scripts"
RELAYER_SCRIPT_DIR="relayer/scripts"
OSMOSIS_SCRIPT_DIR="chains/osmosis/osmosis/scripts"
SQS_SCRIPT_DIR="chains/sqs/scripts"

SCRIPT_DIR=$(dirname $(realpath $0))

title="IBC project Cardano with Cosmos"

title_length=${#title}
echo "╔$(printf '═%.0s' $(seq 1 $((title_length + 2))))╗"
echo "║$(printf ' %.0s' $(seq 1 $((($title_length - ${#title}) / 2))))$title$(printf ' %.0s' $(seq 1 $((($title_length - ${#title}) / 2))))║"
echo "╚$(printf '═%.0s' $(seq 1 $((title_length + 2))))╝"

set_up_osmosis() {
  bash ${SCRIPT_DIR}/chains/osmosis/scripts/setup_submodule_osmosis.sh || return 1
  return 0
}

set_up_sqs() {
  bash ${SCRIPT_DIR}/chains/sqs/script/setup_submodule_sqs.sh || return 1
  return 0
}


set_permission() {
  chmod +x ${SCRIPT_DIR}/${CARDANO_SCRIPT_DIR}/start.sh || return 1
  chmod +x ${SCRIPT_DIR}/${COSMOS_SCRIPT_DIR}/start.sh || return 1
  chmod +x ${SCRIPT_DIR}/${RELAYER_SCRIPT_DIR}/start.sh || return 1
  chmod +x ${SCRIPT_DIR}/${OSMOSIS_SCRIPT_DIR}/start.sh || return 1
  chmod +x ${SCRIPT_DIR}/${SQS_SCRIPT_DIR}/start.sh || return 1
  return 0
}

run() {
    bash ${SCRIPT_DIR}/${CARDANO_SCRIPT_DIR}/start.sh && \
    bash ${SCRIPT_DIR}/${COSMOS_SCRIPT_DIR}/start.sh && \
    bash ${SCRIPT_DIR}/${RELAYER_SCRIPT_DIR}/start.sh && \
    bash ${SCRIPT_DIR}/${SQS_SCRIPT_DIR}/start.sh && \
    bash ${SCRIPT_DIR}/${OSMOSIS_SCRIPT_DIR}/start.sh  || return 1
  return 0
}

if set_up_osmosis; then
  echo >&2 -e "\nSet up osmosis successful!";
else
  echo >&2 -e "\nWARNING: Fails to set up osmosis.";
fi

if set_up_sqs; then
  echo >&2 -e "\nSet up sqs successful!";
else
  echo >&2 -e "\nWARNING: Fails to set up sqs.";
fi

if set_permission; then
    echo >&2 -e "\nSet permission successful!";
else
    echo >&2 -e "\nWARNING: Fails to set permission for the files.";
fi

if ! run; then
  echo >&2 -e "\nFails to start!!!"
else
  echo >&2 -e "\nSystem start completed! Run stop.sh if you want to shutdown the system."
fi