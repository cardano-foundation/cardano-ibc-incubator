#!/bin/bash
# osmosis version v24.0.0

OSMOSISD_CONTAINER_NAME="localosmosis-osmosisd-1"

script_dir=$(dirname $(realpath $0))

# Start osmosisd
cd ${script_dir}/.. && make localnet-startd

# Build contracts while waiting for osmosis started
cd ${script_dir}/../cosmwasm && bash ./build_wasm.sh
docker cp ${script_dir}/../cosmwasm/artifacts $OSMOSISD_CONTAINER_NAME:osmosis/artifacts # copy built contracts to container

# Check if the container is running
while ! docker ps --format '{{.Names}}' | grep -q "^$OSMOSISD_CONTAINER_NAME$"; do
  echo "Container $OSMOSISD_CONTAINER_NAME is not running yet, waiting..."
  sleep 1
done

#=============================Set up channel==============================
cp ${script_dir}/hermes/config.toml ${HOME}/.hermes/config.toml
hermes keys add --chain sidechain --mnemonic-file ${script_dir}/hermes/cosmos
hermes keys add --chain localosmosis --mnemonic-file ${script_dir}/hermes/osmosis

# Create osmosis client
hermes create client --host-chain localosmosis --reference-chain sidechain
localosmosis_client_id=$(hermes --json query clients --host-chain localosmosis | jq -r 'select(.result) | .result[-1].client_id')

# Create sidechain client
hermes create client --host-chain sidechain --reference-chain localosmosis --trusting-period 86000s
sidechain_client_id=$(hermes --json query clients --host-chain sidechain | jq -r 'select(.result) | .result[-1].client_id')

# Create connection
hermes create connection --a-chain sidechain --a-client $sidechain_client_id --b-client $localosmosis_client_id
connectionId=$(hermes --json query connections --chain sidechain | jq -r 'select(.result) | .result[-2]')

# Create channel
hermes create channel --a-chain sidechain --a-connection $connectionId --a-port transfer --b-port transfer
channel_id=$(hermes --json query channels --chain localosmosis | jq -r 'select(.result) | .result[-1].channel_id')
