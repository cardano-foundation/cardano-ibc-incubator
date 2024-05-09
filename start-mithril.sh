#!/usr/bin/env bash
set -e

# Debug mode
if [[ -n $DEBUG ]]; then
    set -x
fi

# Script directory variable
ROOT_DIR=$(dirname $(realpath $0))

SCRIPT_DIRECTORY=${ROOT_DIR}/chains/mithrils/scripts

# Change directory
pushd ${ROOT_DIR} > /dev/null

# Init script
. $SCRIPT_DIRECTORY/mkfiles-init.sh

# Generate the docker files
. $SCRIPT_DIRECTORY/mkfiles-docker.sh

# Start devnet Mithril nodes
echo ">> Info: Mithril Aggregator will be attached to the first Cardano BFT node"
echo ">> Info: Mithril Signers will be attached to each Cardano SPO node"
echo "====================================================================="
echo " Start Mithril nodes"
echo "====================================================================="
echo
. $SCRIPT_DIRECTORY/start-mithril.sh
echo
