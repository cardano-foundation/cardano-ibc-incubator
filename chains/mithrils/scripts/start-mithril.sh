#!/usr/bin/env bash
echo ">> Start Mithril network"
if [ -z "${MITHRIL_IMAGE_ID}" ]; then 
  export MITHRIL_AGGREGATOR_IMAGE="mithril/mithril-aggregator"
  export MITHRIL_CLIENT_IMAGE="mithril/mithril-client"
  export MITHRIL_SIGNER_IMAGE="mithril/mithril-signer"
  echo ">> Build Mithril node Docker images"
  cd chains/mithrils/mithril
  if [ -z "${MITHRIL_NODE_DOCKER_BUILD_TYPE}" ]; then 
    MITHRIL_NODE_DOCKER_BUILD_TYPE=ci
  fi
  if [ -z "${MITHRIL_NODE_DOCKER_CI_IMAGE_FROM}" ]; then 
    MITHRIL_NODE_DOCKER_CI_IMAGE_FROM=debian:12-slim
  fi
  export DOCKER_IMAGE_FROM=$MITHRIL_NODE_DOCKER_CI_IMAGE_FROM
  if [ "${MITHRIL_NODE_DOCKER_BUILD_TYPE}" = "ci" ]; then
    DOCKER_BUILD_CMD="make docker-build-ci" 
  else
    DOCKER_BUILD_CMD="make docker-build"
  fi
  export CARDANO_NODE_VERSION=8.7.3
  echo ">>>> Docker builder will use Cardano node version: '$CARDANO_NODE_VERSION'"
  echo ">>>> Docker builder will build images with command: '$DOCKER_BUILD_CMD'"
  echo ">>>> Building Mithril Aggregator node Docker image"
  cd mithril-aggregator && $DOCKER_BUILD_CMD && cd ..
  echo ">>>> Building Mithril Signer node Docker image"
  cd mithril-signer && $DOCKER_BUILD_CMD && cd ..
  cd ../../..
else
  export MITHRIL_AGGREGATOR_IMAGE="ghcr.io/input-output-hk/mithril-aggregator:${MITHRIL_IMAGE_ID}"
  export MITHRIL_CLIENT_IMAGE="ghcr.io/input-output-hk/mithril-client:${MITHRIL_IMAGE_ID}"
  export MITHRIL_SIGNER_IMAGE="ghcr.io/input-output-hk/mithril-signer:${MITHRIL_IMAGE_ID}"
fi

docker compose rm -f
docker compose -f docker-compose.yaml --profile mithril up --remove-orphans --force-recreate -d --no-build

# echo ">> List of Mithril signers"
#     echo --------,--------------------------------------------------------,----------------------------------- | column -t -s,                                                 
#     cat node-pool1/info.json | jq -r '"\(.name),\(.pool_id),\(.description)"' | column -t -s,
#     cat node-pool2/info.json | jq -r '"\(.name),\(.pool_id),\(.description)"' | column -t -s,

echo ">> Wait for Mithril signers to be registered"
EPOCH_NOW=$(docker exec cardano-node cardano-cli query tip --cardano-mode --testnet-magic 42 2> /dev/null | jq -r .epoch)
while true
do
    EPOCH=$(docker exec cardano-node cardano-cli query tip --cardano-mode --testnet-magic 42 2> /dev/null | jq -r .epoch)
    EPOCH_DELTA=$(( $EPOCH - $EPOCH_NOW ))
    if [ $EPOCH_DELTA -ge 2 ] ; then
        echo ">>>> Ready!"
        break
    else
        echo ">>>> Not ready yet"
        sleep 2
    fi
done

echo ">> Bootstrap the Genesis certificate"
docker compose -f docker-compose.yaml --profile mithril-genesis run mithril-aggregator-genesis
