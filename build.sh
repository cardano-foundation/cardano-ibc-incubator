#!/bin/bash

SCRIPT_DIR=$(dirname $(realpath $0))

# Build mainchain
cd ${SCRIPT_DIR}/cardano/chains && docker compose build

cd ${SCRIPT_DIR}/cardano/cardano-node-services && docker compose build

cd ${SCRIPT_DIR}/cardano/gateway && docker compose build --no-cache

# Build sidechain
cd ${SCRIPT_DIR}/cosmos && docker compose build 

# Build relayer
cd ${SCRIPT_DIR}/relayer && docker compose build 




