# Cardano IBC Swap

## Overview
This folder using to run Cardano IBC Swap frontend (NextJS).

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
| NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT    | RPC end-point of local Osmosis                                                                                                          | Default: http://localhost:26658                                          |
| NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT   | Rest end-point of local Osmosis                                                                                                         | Default: http://localhost:1318                                           |
| NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT | Rest end-point of gateway                                                                                                               | Default: http://localhost:8000. This is only used as the default bridge-manifest host when `NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL` is unset. |
| NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL | URL of the public Cardano bridge manifest                                                                                               | Default: `${NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT}/api/bridge-manifest` |
| IBC_SWAP_KUPMIOS_URL                    | Server-only URLs of Kupo and Ogmios. Never use `NEXT_PUBLIC_` here because an authenticated Demeter hostname may contain its API key.    | Default: "http://localhost:1442,http://localhost:1337"                   |
| IBC_SWAP_KUPO_API_KEY                   | Server-only Kupo API key                                                                                                                 | Optional for endpoints that do not require authentication                 |
| IBC_SWAP_OGMIOS_API_KEY                 | Server-only Ogmios API key                                                                                                               | Optional for endpoints that do not require authentication                 |
| NEXT_PUBLIC_CROSSCHAIN_SWAP_ADDRESS     | Cross-chain swap address on local Osmosis for direct Cardano-to-Osmosis swap packets.                                                  | Optional                                                                 |
| NEXT_PUBLIC_FORWARD_TIMEOUT             | Timeout for packet forwarding                                                                                                           | Default: "60m"                                                           |

Legacy compatibility: `NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT` and `NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT` are still accepted as fallbacks.

The browser never receives Kupmios endpoints or credentials. Provider access,
denom-trace lookup, and Cardano transaction construction use same-origin Next
API routes; the server holds the Kupo and Ogmios configuration.

## Running
After set up the `.env`, run:
```bash
npm ci --legacy-peer-deps && npm run dev
```

## Containerized local run
This frontend is started by the default `caribic start`/`caribic start all`
stack. It can also be managed independently:

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
This project required Node >= 18
