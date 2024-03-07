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

cd ../
cp .env.example .env
aiken build
rm deployments/handler.json


max_retries=5
retry_count=0
file_to_find="deployments/handler.json"

while [ $retry_count -lt $max_retries ]; do
    # Check if the file exists
    if [ -e "$file_to_find" ]; then
        echo "File '$file_to_find' found. Exiting loop."
        break
    else
        echo "File '$file_to_find' not found. Retrying..."
        deno run -A src/deploy.ts 
        retry_count=$((retry_count + 1))
        sleep 5  # You can adjust the sleep duration as needed
    fi
done

if [ $retry_count -eq $max_retries ]; then
    echo "Max retries reached. File '$file_to_find' not found."
    exit 1
fi

cp deployments/handler.json gateway/src/deployment/handler.json

pwd

cd ./cardano-node-services
# ${DOCKER_COMPOSE_CMD} build --no-cache
${DOCKER_COMPOSE_CMD} up -d --build

cd ../gateway
cp ./.env.example .env
${DOCKER_COMPOSE_CMD} up -d --build
