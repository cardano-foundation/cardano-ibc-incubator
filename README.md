# IBC Cardano Cosmos

## System overview

This repo have 3 folders:
- cardano: this folder contain the Cardano chain and also a service named `gateway`, `cardano-node-services` to support replayer fetch/submit IBC related action to Cardano
- cosmos: this folder contain the Cosmos chain, also the module Cardano client
- relayer: this folder contain code of the relayer

## Prerequire:
- Install docker, aiken, deno and jq

## Building services

```sh
./build.sh
```

## Run Cardano chain, Cosmos chain and relayer

```sh
./start.sh

Note: sidechain 1st start take a bit time to sprint up, you can view it logs using:
cd cosmos && docker compose logs sidechain-node-prod -f

When it look like this, you can start to check create/update client:
....
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalizing commit of block hash=2FA357EEC3EF7431C85861E3A331C7D1C8D6D8AEB9751BD3870E003B300F45A7 height=8 module=consensus num_txs=0 root=9FBBFCB424872B3B764B3CEAA9079955BA02DDB1E35B29B867A8D88C7600DA03
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalized block block_app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 module=state num_txs_res=0 num_val_updates=0
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF executed block app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 
....

```

## Stop Cardano chain, Cosmos chain and relayer

```sh
./stop.sh
```

## Faucet:

```sh
Sidechain:

curl -X POST "http://localhost:4500/" -H  "accept: application/json" -H  "Content-Type: application/json" -d "{  \"address\": \"cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6\",  \"coins\": [    \"10token\",\"10stake\"  ]}"

or access to http://localhost:4500

Mainchain:

cd cardano/chains

Open file seed-devnet.sh, navigate to last line, enter your address, save then run: ./seed-devnet.sh
```

## Aiken test:

```sh
cd cardano
aiken check
```

## Run create client:
```sh
docker exec -it relayer /bin/bash # Access to relayer container
cd /home/relayer && bash relayer-start.sh # Start init and create clients on both side

To verify:
- Mainchain: 
    - From root folder of this folder, run cd cardano && deno run -A src/check.ts
    - You will see datum data with client state and consensus state being added
- Sidechain: 
    - Access http://localhost:1317/ibc/core/client/v1/client_states
    - After run script, new client with client_id like "099-cardano-0" will show up

```

## Run update client
```sh

docker exec -it relayer /bin/bash # Access to relayer container
cd /home/relayer && bash update-client.sh # Start update clients on both side

To verify:
- Mainchain: 
    - From root folder of this folder, run cd cardano && deno run -A src/check.ts
    - You will see datum data with client state and consensus state being updated (latestHeight.revisionHeight)
- Sidechain: 
    - Access http://localhost:1317/ibc/core/client/v1/client_states
    - After run script, client_id like "099-cardano-0" will have new value in latest_height.revision_height

```
