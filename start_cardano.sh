#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

cd ${SCRIPT_DIR}

DOCKER_COMPOSE_CMD=
if docker compose --version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  DOCKER_COMPOSE_CMD="docker-compose"
fi

cd ../chains
./run-docker.sh
# $GATEWAY_DIR="$SCRIPT_DIR/../gateway"

cd ../cardano-node-services
${DOCKER_COMPOSE_CMD} up -d 


cd ../gateway
cp ./.env.example .env
${DOCKER_COMPOSE_CMD} up -d 



