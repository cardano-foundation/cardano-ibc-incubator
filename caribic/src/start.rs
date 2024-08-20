use crate::check::check_osmosisd;
use std::path::Path;

/*
#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

git submodule update --init --recursive

# Update cosmwasm
cp -r $SCRIPT_DIR/../configuration/cosmwasm/wasm $SCRIPT_DIR/../osmosis/cosmwasm

# Update scripts
## Add folder hermes
cp -r $SCRIPT_DIR/../configuration/hermes $SCRIPT_DIR/../osmosis/scripts
## Add start.sh
cp $SCRIPT_DIR/../scripts/start.sh $SCRIPT_DIR/../osmosis/scripts/start.sh
## Add stop.sh
cp $SCRIPT_DIR/../scripts/stop.sh $SCRIPT_DIR/../osmosis/scripts/stop.sh

cp $SCRIPT_DIR/../scripts/setup_crosschain_swaps.sh $SCRIPT_DIR/../osmosis/scripts

# Update scripts run docker
rm $SCRIPT_DIR/../osmosis/tests/localosmosis/scripts/setup.sh && cp $SCRIPT_DIR/../scripts/setup_osmosis_local.sh $SCRIPT_DIR/../osmosis/tests/localosmosis/scripts/setup.sh

# Update docker-compose.yml
rm $SCRIPT_DIR/../osmosis/tests/localosmosis/docker-compose.yml && cp $SCRIPT_DIR/../configuration/docker-compose.yml $SCRIPT_DIR/../osmosis/tests/localosmosis/docker-compose.yml

# Update Dockerfile
rm $SCRIPT_DIR/../osmosis/Dockerfile && cp $SCRIPT_DIR/../configuration/Dockerfile $SCRIPT_DIR/../osmosis/Dockerfile

# Remove previous chain data
sudo rm -rf $HOME/.osmosisd-local

cd ${SCRIPT_DIR}/../osmosis && make localnet-init

*/

pub async fn start_osmosis(osmosis_dir: &Path) {
    check_osmosisd(osmosis_dir).await;
}
