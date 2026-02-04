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
| REACT_APP_SIDECHAIN_RPC_ENDPOINT    | RPC end-point of Entrypoint chain    | Default: http://localhost:26657                                          |
| REACT_APP_SIDECHAIN_REST_ENDPOINT   | Rest end-point of Entrypoint chain   | Default: http://localhost:1317                                           |
| REACT_APP_LOCALOSMOIS_RPC_ENDPOINT  | RPC end-point of local Osmosis       | Default: http://localhost:26658                                          |
| REACT_APP_LOCALOSMOIS_REST_ENDPOINT | Rest end-point of local Osmosis      | Default: http://localhost:1318                                           |

## Running
After set up the `.env`, run:
```bash
yarn && yarn start
```

## Note
This project required Node >= 18
