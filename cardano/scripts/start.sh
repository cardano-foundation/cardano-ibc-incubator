#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

function is_gnu_sed(){
  sed --version >/dev/null 2>&1
}

function sed_i_wrapper(){
  if is_gnu_sed; then
    $(which sed) "$@"
  else
    a=()
    for b in "$@"; do
      [[ $b == '-i' ]] && a=("${a[@]}" "$b" "") || a=("${a[@]}" "$b")
    done
    $(which sed) "${a[@]}"
  fi
}

cd ${SCRIPT_DIR}

DOCKER_COMPOSE_CMD=
if docker compose --version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  DOCKER_COMPOSE_CMD="docker-compose"
fi

AIKEN="aiken"
if [[ "$USER" = "jenkins" ]] ; then
  AIKEN="/var/lib/jenkins/.aiken/bin/aiken"
fi

DENO="deno"
if [[ "$USER" = "jenkins" ]] ; then
  DENO="/var/lib/jenkins/.deno/bin/deno"
fi

cd ../chains
./run-docker.sh
# $GATEWAY_DIR="$SCRIPT_DIR/../gateway"

cd ../
cp .env.example .env
${AIKEN} build --trace-level verbose
${DENO} run -A ./aiken-to-lucid/src/main.ts
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
        ${DENO} run -A src/deploy.ts
        retry_count=$((retry_count + 1))
        sleep 5  # You can adjust the sleep duration as needed
    fi
done

if [ $retry_count -eq $max_retries ]; then
    echo "Max retries reached. File '$file_to_find' not found."
    exit 1
fi

folder="gateway/src/deployment"

# Check if the folder exists
if [ ! -d "$folder" ]; then
    # If it doesn't exist, create it
    mkdir -p "$folder"
fi

cp deployments/handler.json gateway/src/deployment/handler.json

# prepare tokenName
tokenName=$(cat ./deployments/handler.json | jq -r .tokens.mock)
file_path="../relayer/scripts/xtransfer.sh"
replacement="amount2=1000-$tokenName"

# Use sed to replace the line in the file
sed_i_wrapper -i "s/^amount2=1000.*/$replacement/gm" "$file_path"

cd ./cardano-node-services
# ${DOCKER_COMPOSE_CMD} build
${DOCKER_COMPOSE_CMD} stop
${DOCKER_COMPOSE_CMD} up -d --build

cd ../gateway
cp ./.env.example .env
# ${DOCKER_COMPOSE_CMD} build
${DOCKER_COMPOSE_CMD} stop
${DOCKER_COMPOSE_CMD} up -d --build