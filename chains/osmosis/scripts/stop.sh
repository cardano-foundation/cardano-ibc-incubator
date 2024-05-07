#!/bin/bash

# osmosis version v24.0.0

SCRIPT_DIR=$(dirname $(realpath $0))

cd  ${SCRIPT_DIR}/.. && make localnet-stop