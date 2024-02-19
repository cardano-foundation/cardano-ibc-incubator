#!/bin/bash

TX_CARDANO_REPOSITORY="https://git02.smartosc.com/cardano/ibc-sidechain/tx-cardano.git"
TX_CARDANO_FOLDER_NAME="tx-cardano"
COSMOS_TYPES_REPOSITORY="https://git02.smartosc.com/cardano/ibc-sidechain/mainchain.git"
COSMOS_TYPES_FOLDER_NAME="cosmjs-types"
git submodule add --force ${TX_CARDANO_REPOSITORY} ${TX_CARDANO_FOLDER_NAME}
git submodule add --force ${COSMOS_TYPES_REPOSITORY} ${COSMOS_TYPES_FOLDER_NAME}

# update code for all submodules
git submodule update --remote --init --recursive