#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

git submodule update --init --recursive

# Update cosmwasm 
sudo rm -rf $SCRIPT_DIR/../osmosis/cosmwasm && cp -r $SCRIPT_DIR/../configuration/cosmwasm $SCRIPT_DIR/../osmosis/cosmwasm

# Update scripts
## Add folder hermes 
cp -r $SCRIPT_DIR/../configuration/hermes $SCRIPT_DIR/../osmosis/scripts
## Add start.sh 
cp $SCRIPT_DIR/../scripts/start.sh $SCRIPT_DIR/../osmosis/scripts/start.sh
## Add stop.sh 
cp $SCRIPT_DIR/../scripts/stop.sh $SCRIPT_DIR/../osmosis/scripts/stop.sh

# Update scripts run docker 
rm $SCRIPT_DIR/../osmosis/tests/localosmosis/scripts/setup.sh && cp $SCRIPT_DIR/../scripts/setup_osmosis_local.sh $SCRIPT_DIR/../osmosis/tests/localosmosis/scripts/setup.sh

# Update docker-compose.yml
rm $SCRIPT_DIR/../osmosis/tests/localosmosis/docker-compose.yml && cp $SCRIPT_DIR/../configuration/docker-compose.yml $SCRIPT_DIR/../osmosis/tests/localosmosis/docker-compose.yml

# Update Dockerfile
rm $SCRIPT_DIR/../osmosis/Dockerfile && cp $SCRIPT_DIR/../configuration/Dockerfile $SCRIPT_DIR/../osmosis/Dockerfile

cd ${SCRIPT_DIR}/../osmosis && make localnet-init