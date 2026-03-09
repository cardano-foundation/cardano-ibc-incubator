# Cardano IBC Explorer

## Overview
This folder using to run Cardano IBC Explorer frontend (Reactjs).

## Setup
Create `.env` files with the following variables:

| Variable                            | Meaning                              | Note                                                                     |
|-------------------------------------|:-------------------------------------|:-------------------------------------------------------------------------|
| PORT                                | React will run instance on this port | Default: 8080                                                            |
| REACT_APP_API_DOMAIN                | Rest end-point of subql-query        | You will get it after running indexer, will be the url to graphql-engine |
| REACT_APP_CARDANO_CHAIN_ID          | Network magic of Cardano chain       | Currently we use 42 for local Cardano, for preview, it will be 2         |
| REACT_APP_ENTRYPOINT_RPC_ENDPOINT   | RPC end-point of Entrypoint chain    | Default: http://localhost:26657                                          |
| REACT_APP_ENTRYPOINT_REST_ENDPOINT  | Rest end-point of Entrypoint chain   | Default: http://localhost:1317                                           |
| REACT_APP_LOCALOSMOSIS_RPC_ENDPOINT | RPC end-point of local Osmosis       | Default: http://localhost:26658                                          |
| REACT_APP_LOCALOSMOSIS_REST_ENDPOINT| Rest end-point of local Osmosis      | Default: http://localhost:1318                                           |

Legacy compatibility: `REACT_APP_SIDECHAIN_RPC_ENDPOINT` and `REACT_APP_SIDECHAIN_REST_ENDPOINT` are still accepted as fallbacks.

## Running
After set up the `.env`, run:
```bash
yarn && yarn start
```

## Containerized local run
This frontend is optional and is not started by `caribic start`.

To run it as a containerized demo UI:

```bash
docker compose -f dapps/docker-compose.yml up --build ibc-explorer
```

By default the container is published on `http://localhost:8081` so it does not
collide with the local Mithril service already using host port `8080`. Override
that with `IBC_EXPLORER_HOST_PORT` if needed.

See [dapps/README.md](../README.md) for compose variables and default local endpoint wiring.

## Note
This project required Node >= 18
