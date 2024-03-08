# Cardano IBC Incubator
This project is working towards a bridge implementation to allow exchange of information from a Cardano blockchain to Cosmos SDK based blockchains. 

It follows the [inter-blockchain communication protocol](https://github.com/cosmos/ibc) and is trying to achieve full compliance with the parts of the specification identified necessary for the developed framework.

## :heavy_exclamation_mark: Disclaimer
Please be aware that this is an incubator project and by this means it is neither complete nor sufficiently tested at the current point in time to be used for production grade operation of a bridge. So the use of the source code and software artifacts in this repository are subject to your own discretion and risk.

:heavy_exclamation_mark: The software withing this repository is provided to you on an "as is" and "as available" basis.

While we strive for high functionality and user satisfaction and endeavour to maintain reliability and accuracy, unforeseen issues may arise due to the experimental nature of this project.

## :eyes: Overview
This repository is subdivided into three main folders:
- `cardano`: Contains all Cardano related source code that are part of the bridge as well as some facilities for bringing up a local Cardano blockchain for test and development purposes. It also contains the Aiken based Tendermint Light Client and IBC primitives implementation.
- `cosmos`: Contains all Cosmos SDK related source code including the Cardano light client (or thin client) implementation running on the Cosmos chain. The folder was scaffolded via [Ignite CLI](https://docs.ignite.com/) with [Cosmos SDK 0.50](https://github.com/cosmos/cosmos-sdk).
- `relayer`: Contains all relayer related source code. Forked from https://github.com/cosmos/relayer

## :rocket: Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Aiken](https://aiken-lang.org/installation-instructions)
- [deno](https://docs.deno.com/runtime/manual/getting_started/installation)
- [jq](https://jqlang.github.io/jq/download/)

### Cardano developer ecosystem components used
The current implementation leverages a number of frameworks maintained by the Cardano developer community. We list them here for appreciation and transparency. Without tools like those listed and others, projects like this would not be possible:
- [Pallas](https://github.com/txpipe/pallas)
- [Lucid](https://github.com/spacebudz/lucid)
- [Ogmios](https://github.com/cardanosolutions/ogmios)
- [Kupo](https://github.com/cardanosolutions/kupo)
- [db-sync](https://github.com/IntersectMBO/cardano-db-sync)

### Build from source
```sh
./build.sh
```

### Running a test environment on a local machine

```sh
./start.sh
```

Note: This will spin up a local Cardano and Cosmos blockchain and a relayer instance.

Note: On 1st start of the sidechain it might take a bit time to be readily booted. You can check in the logs if it is done via:

```sh
cd cosmos && docker compose logs sidechain-node-prod -f
```

When it look like this, you can start to check create/update client:
```sh
....
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalizing commit of block hash=2FA357EEC3EF7431C85861E3A331C7D1C8D6D8AEB9751BD3870E003B300F45A7 height=8 module=consensus num_txs=0 root=9FBBFCB424872B3B764B3CEAA9079955BA02DDB1E35B29B867A8D88C7600DA03
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF finalized block block_app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 module=state num_txs_res=0 num_val_updates=0
sidechain-node-prod-1  | [SIDECHAIND] 10:12AM INF executed block app_hash=5EBC66EF091AEF3CB4E5BC6A31F5713162739A4127EB59AF3A47DB4BF26B3AE8 height=8 
....
```

### Stopping the test environment

```sh
./stop.sh
```

### Faucet

Sidechain:
```sh
curl -X POST "http://localhost:4500/" -H  "accept: application/json" -H  "Content-Type: application/json" -d "{  \"address\": \"cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6\",  \"coins\": [    \"10token\",\"10stake\"  ]}"
```

or access to `http://localhost:4500`

Mainchain:

```sh
cd cardano/chains
```

Open file `seed-devnet.sh`, navigate to last line, enter your address, save then run: `./seed-devnet.sh`

### Run the Aiken tests

```sh
cd cardano
aiken check
```

### Create a client
```sh
docker exec -it relayer /bin/bash # Access to relayer container
cd /home/relayer && bash relayer-start.sh # Start init and create clients on both side
```

To verify:
- Mainchain: 
    - From the repository root folder, run `cd cardano && deno run -A src/check.ts`
    - You will see datum data with client state and consensus state being added
- Sidechain:
    - Access `http://localhost:1317/ibc/core/client/v1/client_states`
    - After run script, new client with client_id like "099-cardano-0" will show up

### Update a client
```sh
docker exec -it relayer /bin/bash # Access to relayer container
cd /home/relayer && bash update-client.sh # Start update clients on both side
```

To verify:
- Mainchain: 
    - From the repository root folder, run `cd cardano && deno run -A src/check.ts`
    - You will see datum data with client state and consensus state being updated (`latestHeight.revisionHeight`)
- Sidechain:
    - Access `http://localhost:1317/ibc/core/client/v1/client_states`
    - After run script, client_id like `099-cardano-0` will have new value in `latest_height.revision_height`

## :blue_heart: Contributing
All contributions are welcome! Please feel free to open a new thread on the issue tracker or submit a new pull request.

Please read [Contributing](CONTRIBUTING.md) in advance. Thank you for contributing!

## :books: Additional Documents
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)
