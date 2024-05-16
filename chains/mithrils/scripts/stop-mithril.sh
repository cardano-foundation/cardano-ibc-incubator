#!/usr/bin/env bash

echo ">> Stop Cardano network"
killall cardano-node

echo ">> Stop Mithril network"
if [ -z "${MITHRIL_IMAGE_ID}" ]; then 
  export MITHRIL_AGGREGATOR_IMAGE="mithril/mithril-aggregator"
  export MITHRIL_CLIENT_IMAGE="mithril/mithril-client"
  export MITHRIL_SIGNER_IMAGE="mithril/mithril-signer"
else
  export MITHRIL_AGGREGATOR_IMAGE="ghcr.io/input-output-hk/mithril-aggregator:${MITHRIL_IMAGE_ID}"
  export MITHRIL_CLIENT_IMAGE="ghcr.io/input-output-hk/mithril-client:${MITHRIL_IMAGE_ID}"
  export MITHRIL_SIGNER_IMAGE="ghcr.io/input-output-hk/mithril-signer:${MITHRIL_IMAGE_ID}"
fi
docker compose -f docker-compose.yaml --profile mithril down
