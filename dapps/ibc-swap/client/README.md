# Cardano IBC Swap

## Overview
This folder using to run Cardano IBC Swap frontend (NextJS).

## Setup
Create `.env` files with the following variables:

| Variable                                | Meaning                                                                                                                                 | Note                                                                     |
|-----------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------|
| BASE_PATH                               | NextJs will run instance under sub-path of a domain, refer to [this](https://nextjs.org/docs/app/api-reference/next-config-js/basePath) | Default: "/ibc"                                                          |
| NEXT_PUBLIC_CARDANO_CHAIN_ID            | Network magic of Cardano chain                                                                                                          | Currently we use 42 for local Cardano, for preview, it will be 2         |
| NEXT_PUBLIC_ENTRYPOINT_RPC_ENDPOINT     | RPC end-point of Entrypoint chain                                                                                                       | Default: http://localhost:26657                                          |
| NEXT_PUBLIC_ENTRYPOINT_REST_ENDPOINT    | Rest end-point of Entrypoint chain                                                                                                      | Default: http://localhost:1317                                           |
| NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT    | RPC end-point of local Osmosis                                                                                                          | Default: http://localhost:26658                                          |
| NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT   | Rest end-point of local Osmosis                                                                                                         | Default: http://localhost:1318                                           |
| NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT | Rest end-point of gateway                                                                                                               | Default: http://localhost:8000. This is used for tx building and Cardano asset-to-IBC metadata lookup. |
| NEXT_PUBLIC_KUPMIOS_URL                 | Url of Kupo and Ogmios instances, should not be use when using NEXT_PUBLIC_BLOCKFROST_PROJECT_ID                                        | Default: "http://localhost:1442,http://localhost:1337"                   |
| NEXT_PUBLIC_BLOCKFROST_PROJECT_ID       | Blockfrost Project ID, currently only support network preview, should not be use when using NEXT_PUBLIC_KUPMIOS_URL                     | Default: "previewVi2O..."                                                |
| NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS     | Cross-chain swap address on local Osmosis. This is still required by the local browser demo swap memo builder.                          | You will get this after run `setup_crosschain_swaps.sh`                  |
| NEXT_PUBLIC_FORWARD_TIMEOUT             | Timeout for packet forwarding                                                                                                           | Default: "60m"                                                           |

Legacy compatibility: `NEXT_PUBLIC_SIDECHAIN_RPC_ENDPOINT`, `NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT`, `NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT`, and `NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT` are still accepted as fallbacks.

TODO: This demo client should not depend on the gateway long term. The current
gateway dependency is temporary while we work on fully decoupling dapps from the
relayer/gateway layer. The next prerequisite is moving the denom trace registry
on-chain, which is still in progress. Once that is done, we can continue the
decoupling so the gateway is only used by the relayer.

## Running
After set up the `.env`, run:
```bash
yarn && yarn dev
```

## Containerized local run
This frontend is optional and is not started by `caribic start`.

To run it as a containerized demo UI:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
```

By default the container is published on `http://localhost:3000`. Override
that with `IBC_SWAP_HOST_PORT` if needed.

See [dapps/README.md](../../README.md) for compose variables and default local endpoint wiring.

## Note
This project required Node >= 18
