# Cardano IBC Swap

## Overview
This Next.js frontend supports Cardano transfers with the local `v8-classic`
Cosmos fixture or Injective in public testnet and mainnet modes.

## Setup
Create `.env` files with the following variables. Chain settings are read when
the server starts; the optional base path is the one exception because Next.js
fixes it while building the application:

| Variable                                | Meaning                                                                                                                                 | Note                                                                     |
|-----------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------|
| IBC_SWAP_BASE_PATH                      | Optional URL prefix passed to the container as a build argument                                                                         | Default: empty (served at `/`); an already-built image cannot change this |
| NEXT_PUBLIC_IBC_SWAP_MODE               | Overall topology                                                                                                                         | `local`, `testnet`, or `mainnet`                                          |
| NEXT_PUBLIC_CARDANO_NETWORK             | Cardano network label used by runtime config and UI                                                                                     | `devnet`, `preprod`, `preview`, or `mainnet`; inferred from chain IDs if unset |
| NEXT_PUBLIC_CARDANO_CHAIN_ID            | Network magic of Cardano chain                                                                                                          | 42 for local/devnet, 1 for preprod, 2 for preview                        |
| NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID        | Cardano IBC chain identifier                                                                                                             | `cardano-devnet`, `cardano-preprod`, `cardano-preview`, or `cardano-mainnet` |
| NEXT_PUBLIC_LOCAL_COSMOS_RPC_ENDPOINT    | RPC end-point of local Cosmos fixture                                                                                                          | Default: http://localhost:26757                                          |
| NEXT_PUBLIC_LOCAL_COSMOS_REST_ENDPOINT   | Rest end-point of local Cosmos fixture                                                                                                         | Default: http://localhost:1327                                           |
| NEXT_PUBLIC_INJECTIVE_RPC_ENDPOINT | Injective RPC endpoint | Defaults to the public testnet endpoint in `testnet` mode. Required for `mainnet`. |
| NEXT_PUBLIC_INJECTIVE_REST_ENDPOINT | Injective REST endpoint | Defaults to the public testnet endpoint in `testnet` mode. Required for `mainnet`. |
| NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT | Rest end-point of gateway                                                                                                               | Default: http://localhost:8000. This is only used as the default bridge-manifest host when `NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL` is unset. |
| NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL | URL of the public Cardano bridge manifest                                                                                               | Default: `${NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT}/api/bridge-manifest` |
| IBC_SWAP_KUPMIOS_URL                    | Server-only URLs of Kupo and Ogmios. Never use `NEXT_PUBLIC_` here because an authenticated Demeter hostname may contain its API key.    | Default: "http://localhost:1442,http://localhost:1337"                   |
| IBC_SWAP_KUPO_API_KEY                   | Server-only Kupo API key                                                                                                                 | Optional for endpoints that do not require authentication                 |
| IBC_SWAP_OGMIOS_API_KEY                 | Server-only Ogmios API key                                                                                                               | Optional for endpoints that do not require authentication                 |
| NEXT_PUBLIC_FORWARD_TIMEOUT             | Timeout for packet forwarding                                                                                                           | Default: "60m"                                                           |


The browser never receives Kupmios endpoints or credentials. Provider access,
denom-trace lookup, and Cardano transaction construction use same-origin Next
API routes; the server holds the Kupo and Ogmios configuration.

## Running
After set up the `.env`, run:
```bash
npm ci --legacy-peer-deps && npm run dev
```

## Containerized local run
Caribic starts this frontend for public testnet routes. Local mode can be run
through Compose. Caribic also provides these commands for supported networks:

```bash
caribic start dapp
caribic stop dapp
```

To run it directly through Compose instead:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-swap-client
```

By default the container is published on `http://localhost:3000`. Override
that with `IBC_SWAP_HOST_PORT` if needed.

See [dapps/README.md](../../README.md) for compose variables and default local endpoint wiring.

## Note
This project requires Node.js 22.13 or newer for the shared transaction runtime's SQLite support.
