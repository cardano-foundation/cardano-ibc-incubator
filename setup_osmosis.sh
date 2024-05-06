#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

# Update cosmwasm 
rm -rf $SCRIPT_DIR/chains/osmosis/cosmwasm && cp -r $SCRIPT_DIR/chains/osmosis-setup/cosmwasm $SCRIPT_DIR/chains/osmosis/cosmwasm

# Update scripts
## Add folder hermes 
cp -r $SCRIPT_DIR/chains/osmosis-setup/hermes $SCRIPT_DIR/chains/osmosis/scripts/hermes
## Add start.sh 
cp $SCRIPT_DIR/chains/osmosis-setup/start.sh $SCRIPT_DIR/chains/osmosis/scripts/start.sh
## Add stop.sh 
cp $SCRIPT_DIR/chains/osmosis-setup/stop.sh $SCRIPT_DIR/chains/osmosis/scripts/stop.sh

# Update scripts run docker 
rm $SCRIPT_DIR/chains/osmosis/tests/localosmosis/scripts/setup.sh && cp $SCRIPT_DIR/chains/osmosis-setup/setup.sh $SCRIPT_DIR/chains/osmosis/tests/localosmosis/scripts/setup.sh

# Update docker-compose.yml
rm -rf $SCRIPT_DIR/chains/osmosis/tests/localosmosis/docker-compose.yml && cp $SCRIPT_DIR/chains/osmosis-setup/docker-compose.yml $SCRIPT_DIR/chains/osmosis/tests/localosmosis/docker-compose.yml

# Update Dockerfile
rm -rf $SCRIPT_DIR/chains/osmosis/Dockerfile && cp $SCRIPT_DIR/chains/osmosis-setup/Dockerfile $SCRIPT_DIR/chains/osmosis/Dockerfile

# Update .osmosis-local
rm -rf $HOME/.osmosis-local && cp -r $SCRIPT_DIR/chains/osmosis-setup/.osmosis-local $HOME/.osmosis-local