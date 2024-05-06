#!/bin/bash

SCRIPT_DIR=$(dirname $(realpath $0))

# Build mainchain
cd ${SCRIPT_DIR}/cardano/chains && docker compose build

cd ${SCRIPT_DIR}/cardano/gateway && docker compose build --no-cache

# Build sidechain
cd ${SCRIPT_DIR}/cosmos && docker compose build 

# Build relayer
cd ${SCRIPT_DIR}/relayer && docker compose build 

# Build osmosis
git submodule update --remote --merge
chmod +x ${SCRIPT_DIR}/setup_osmosis.sh
bash ${SCRIPT_DIR}/setup_osmosis.sh
cd ${SCRIPT_DIR}/chains/osmosis && make localnet-init

