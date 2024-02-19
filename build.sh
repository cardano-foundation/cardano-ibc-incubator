#!/bin/bash

SCRIPT_DIR=$(dirname $(realpath $0))

# Build mainchain
cd ${SCRIPT_DIR}/cardano/chains && docker compose build 

# Build sidechain
cd ${SCRIPT_DIR}/cosmos && docker compose build 

# Build relayer
cd ${SCRIPT_DIR}/relayer && docker compose build 




