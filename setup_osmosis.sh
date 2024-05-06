#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

# Update cosmwasm 
rm -rf $SCRIPT_DIR/chains/osmosis/osmosis/cosmwasm && cp -r $SCRIPT_DIR/chains/osmosis/configuration/cosmwasm $SCRIPT_DIR/chains/osmosis/osmosis/cosmwasm

# Update scripts
## Add folder hermes 
cp -r $SCRIPT_DIR/chains/osmosis/configuration/hermes $SCRIPT_DIR/chains/osmosis/osmosis/scripts/hermes
## Add start.sh 
cp $SCRIPT_DIR/chains/osmosis/scripts/start.sh $SCRIPT_DIR/chains/osmosis/osmosis/scripts/start.sh
## Add stop.sh 
cp $SCRIPT_DIR/chains/osmosis/scripts/stop.sh $SCRIPT_DIR/chains/osmosis/osmosis/scripts/stop.sh

# Update scripts run docker 
rm $SCRIPT_DIR/chains/osmosis/osmosis/tests/localosmosis/scripts/setup.sh && cp $SCRIPT_DIR/chains/osmosis/scripts/setup.sh $SCRIPT_DIR/chains/osmosis/osmosis/tests/localosmosis/scripts/setup.sh

# Update docker-compose.yml
rm -rf $SCRIPT_DIR/chains/osmosis/osmosis/tests/localosmosis/docker-compose.yml && cp $SCRIPT_DIR/chains/osmosis/configuration/docker-compose.yml $SCRIPT_DIR/chains/osmosis/osmosis/tests/localosmosis/docker-compose.yml

# Update Dockerfile
rm -rf $SCRIPT_DIR/chains/osmosis/osmosis/Dockerfile && cp $SCRIPT_DIR/chains/osmosis/configuration/Dockerfile $SCRIPT_DIR/chains/osmosis/osmosis/Dockerfile

# Update .osmosis-local
rm -rf $HOME/.osmosis-local && cp -r $SCRIPT_DIR/chains/osmosis/configuration/.osmosis-local $HOME/.osmosis-local