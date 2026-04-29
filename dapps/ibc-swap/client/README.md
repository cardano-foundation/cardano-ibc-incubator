# Cardano IBC Swap

## Overview
This folder using to run Cardano IBC Swap frontend (NextJS).

## Setup
Create `.env` files with the following variables:

| Variable                                | Meaning                                                                                                                                 | Note                                                                     |
|-----------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------|
| BASE_PATH                               | NextJs will run instance under sub-path of a domain, refer to [this](https://nextjs.org/docs/app/api-reference/next-config-js/basePath) | Default: "/ibc"                                                          |
| NEXT_PUBLIC_IBC_SWAP_MODE               | Runtime-locked frontend mode                                                                                                            | `local`, `testnet`, or `mainnet`; default: `local`                       |
| NEXT_PUBLIC_CARDANO_CHAIN_ID            | Network magic of Cardano chain                                                                                                          | Default: `42` local, `1` testnet/preprod, `764824073` mainnet            |
| NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID        | IBC chain id used by the Cardano bridge                                                                                                 | Default: `cardano-devnet`, `cardano-preprod`, or `cardano-mainnet`       |
| NEXT_PUBLIC_ENTRYPOINT_RPC_ENDPOINT     | RPC end-point of Entrypoint chain                                                                                                       | Default: http://localhost:26657                                          |
| NEXT_PUBLIC_ENTRYPOINT_REST_ENDPOINT    | Rest end-point of Entrypoint chain                                                                                                      | Default: http://localhost:1317                                           |
| NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT    | RPC end-point of local Osmosis                                                                                                          | Default: http://localhost:26658                                          |
| NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT   | Rest end-point of local Osmosis                                                                                                         | Default: http://localhost:1318                                           |
| NEXT_PUBLIC_INJECTIVE_RPC_ENDPOINT      | RPC endpoint for the active Injective profile                                                                                           | Defaults to Injective testnet public RPC in `testnet` mode               |
| NEXT_PUBLIC_INJECTIVE_REST_ENDPOINT     | REST endpoint for the active Injective profile                                                                                          | Defaults to Injective testnet public REST in `testnet` mode              |
| NEXT_PUBLIC_ENABLE_MAINNET_IBC_SWAP     | Enables executable mainnet routes when all mainnet config is supplied                                                                   | Default: disabled                                                        |
| NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT | Rest end-point of gateway                                                                                                               | Default: http://localhost:8000. This is only used as the default bridge-manifest host when `NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL` is unset. |
| NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL | URL of the public Cardano bridge manifest                                                                                               | Default: `${NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT}/api/bridge-manifest` |
| NEXT_PUBLIC_KUPMIOS_URL                 | Url of Kupo and Ogmios instances, should not be use when using NEXT_PUBLIC_BLOCKFROST_PROJECT_ID                                        | Default: "http://localhost:1442,http://localhost:1337"                   |
| NEXT_PUBLIC_BLOCKFROST_PROJECT_ID       | Blockfrost Project ID, currently only support network preview, should not be use when using NEXT_PUBLIC_KUPMIOS_URL                     | Default: "previewVi2O..."                                                |
| NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS     | Cross-chain swap address on local Osmosis. This is still required by the local browser demo swap memo builder.                          | You will get this after run `setup_crosschain_swaps.sh`                  |
| NEXT_PUBLIC_FORWARD_TIMEOUT             | Timeout for packet forwarding                                                                                                           | Default: "60m"                                                           |

Legacy compatibility: `NEXT_PUBLIC_SIDECHAIN_RPC_ENDPOINT`, `NEXT_PUBLIC_SIDECHAIN_REST_ENDPOINT`, `NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT`, and `NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT` are still accepted as fallbacks.

TODO: This demo client should not depend on the gateway long term. Today
denom-trace lookup, route planning, and unsigned Cardano transfer tx building
all run through shared local packages, but bridge-manifest bootstrap still
defaults to the gateway unless `NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL` is
set explicitly.

## Running
After set up the `.env`, run:
```bash
yarn && yarn dev
```

## Containerized local run
The default `caribic start` stack starts this frontend automatically. It can
also be managed independently:

```bash
caribic start dapp
caribic stop dapp
```

To run it through compose directly:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
```

By default the container is published on `http://localhost:3000`. Override
that with `IBC_SWAP_HOST_PORT` if needed.

See [dapps/README.md](../../README.md) for compose variables and default local endpoint wiring.

## Note
This project required Node >= 18
