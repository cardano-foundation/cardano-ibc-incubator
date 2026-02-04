# Cardano IBC Swap

## Overview
This folder using to run Cardano IBC Swap frontend (NextJS).

## Setup
Create `.env` files with the following variables:

| Variable                                | Meaning                                                                                                                                 | Note                                                                     |
|-----------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------|
| BASE_PATH                               | NextJs will run instance under sub-path of a domain, refer to [this](https://nextjs.org/docs/app/api-reference/next-config-js/basePath) | Default: "/ibc"                                                          |
| NEXT_PUBLIC_CARDANO_CHAIN_ID            | Network magic of Cardano chain                                                                                                          | Currently we use 42 for local Cardano, for preview, it will be 2         |
| NEXT_PUBLIC_SIDECHAIN_RPC_ENDPOINT      | RPC end-point of Entrypoint chain                                                                                                       | Default: http://localhost:26657                                          |
| NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT     | Rest end-point of Entrypoint chain                                                                                                      | Default: http://localhost:1317                                           |
| NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT    | RPC end-point of local Osmosis                                                                                                          | Default: http://localhost:26658                                          |
| NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT | Rest end-point of gateway                                                                                                               | Default: http://localhost:8000                                           |
| NEXT_PUBLIC_GRAPHQL_SUBQUERY_ENDPOINT   | Rest end-point of subql-query                                                                                                           | You will get it after running indexer, will be the url to graphql-engine |
| NEXT_PUBLIC_KUPMIOS_URL                 | Url of Kupo and Ogmios instances, should not be use when using NEXT_PUBLIC_BLOCKFROST_PROJECT_ID                                        | Default: "http://localhost:1442,http://localhost:1337"                   |
| NEXT_PUBLIC_BLOCKFROST_PROJECT_ID       | Blockfrost Project ID, currently only support network preview, should not be use when using NEXT_PUBLIC_KUPMIOS_URL                     | Default: "previewVi2O..."                                                |
| NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS     | Cross-chain swap address on local Osmosis                                                                                               | You will get this after run `setup_crosschain_swaps.sh`                  |
| NEXT_PUBLIC_SWAP_ROUTER_ADDRESS         | Cross-chain swap router address on local Osmosis                                                                                        | You will get this after run `setup_crosschain_swaps.sh`                  |
| NEXT_PUBLIC_FORWARD_TIMEOUT             | Timeout for packet forwarding                                                                                                           | Default: "60m"                                                           |

## Running
After set up the `.env`, run:
```bash
yarn && yarn dev
```

## Note
This project required Node >= 18
