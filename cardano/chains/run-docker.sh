#!/usr/bin/env bash
#
# Prepare environment to run the demo cluster, then launches docker-compose demo.
# If there's already a demo running, bail out.
set -e

SCRIPT_DIR=$(dirname $(realpath $0))

cd ${SCRIPT_DIR}

DOCKER_COMPOSE_CMD=
if docker compose --version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  DOCKER_COMPOSE_CMD="docker-compose"
fi

# Sanity check to prevent accidentally tripping oneself with an existing demo
# if ( ${DOCKER_COMPOSE_CMD} ps | grep hydra-node > /dev/null 2>&1 ); then
#   echo >&2 -e "# Demo already in progress, exiting"
#   echo >&2 -e "# To stop the demo use: ${DOCKER_COMPOSE_CMD} down"
#   exit 1
# fi

"${SCRIPT_DIR}/prepare-devnet.sh"
${DOCKER_COMPOSE_CMD} up -d cardano-node postgres kupo cardano-node-ogmios
# ${DOCKER_COMPOSE_CMD} --profile cardano-node up -d

echo >&2 -e "\n# Sleep 5 sec"
sleep 5

"${SCRIPT_DIR}/seed-devnet.sh"
sudo chown "${USER:=$(/usr/bin/id -run)}" "$SCRIPT_DIR/devnet/node.socket"

"${SCRIPT_DIR}/prepare-db-sync.sh"
${DOCKER_COMPOSE_CMD} up -d cardano-db-sync
# ${DOCKER_COMPOSE_CMD} --profile cardano-db-sync up -d

echo >&2 -e "\n# Run to connect to socket: export CARDANO_NODE_SOCKET_PATH=${SCRIPT_DIR}/devnet/node.socket"
echo >&2 -e "\n# Query tip: cardano-cli query tip --testnet-magic 42"
echo >&2 -e "\n# Or: docker compose exec cardano-node cardano-cli query tip --testnet-magic 42"
echo >&2 -e "\n# Query address utxo: docker compose exec cardano-node cardano-cli query utxo --address addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m --testnet-magic 42"
echo >&2 -e "\n# Stop the demo: ${DOCKER_COMPOSE_CMD} down\n"

# echo >&2 -e "\n# Sleep 120 sec, wait for services to sync"
# sleep 120
