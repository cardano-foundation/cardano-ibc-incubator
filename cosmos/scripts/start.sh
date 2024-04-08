#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

cd ${SCRIPT_DIR}

DOCKER_COMPOSE_CMD=
if docker compose --version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  DOCKER_COMPOSE_CMD="docker-compose"
fi

cd ../

${DOCKER_COMPOSE_CMD} stop
${DOCKER_COMPOSE_CMD} up -d --build

faucet_url="http://localhost:4500"
while true; do
  response=$(curl -s -o /dev/null -w "%{http_code}" $faucet_url)

  if [[ $response == "200" ]]; then
    echo >&2 "Sidechain is ready!"
    break
  else
    echo >&2 "Sidechain is starting. Continue checking..."
    sleep 5
  fi
done