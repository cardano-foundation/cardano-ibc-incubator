#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

cd ${SCRIPT_DIR}

DOCKER_COMPOSE_CMD=
if docker compose --version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  DOCKER_COMPOSE_CMD="docker-compose"
fi

# Can build program binary when start up
# go build -o bin/rly
cd ../
${DOCKER_COMPOSE_CMD} build
${DOCKER_COMPOSE_CMD} up -d 