# SubQuery Indexer Multi Chain

## Run your project

_If you get stuck, find out how to get help below._

The simplest way to run your project is by running `yarn dev` or `npm run-script dev`. This does all of the following:
1. `cp .env.example .env` - You need to create a .env file, which stores environment-specific configurations. To do that, copy the .env.example file and rename it to .env
Example .env file content:
```javascript
SUBQL_SIDE_CHAIN_RPC=http://0.0.0.0:1317 - REST API of Sidechain
SUBQL_LOCAL_OSMOSIS_RPC=http://0.0.0.0:1318 - REST of Osmosis

SUBQL_SIDE_CHAIN_ENDPOINT=http://0.0.0.0:26657 - RPC Endpoint of Sidechain
SUBQL_LOCAL_OSMOSIS_ENDPOINT=http://0.0.0.0:26658 - RPC Endpoint of Osmosis
SUBQL_CARDANO_ENDPOINT=ws://0.0.0.0:3001 - N2N Websocket of Cardano
```
2.  `yarn codegen` - Generates types from the GraphQL schema definition and contract ABIs and saves them in the `/src/types` directory. This must be done after each change to the `schema.graphql` file or the contract ABIs
3.  `yarn build` - Builds and packages the SubQuery project into the `/dist` directory
4.  `docker-compose pull && docker-compose up` - Runs a Docker container with an indexer, PostgeSQL DB, and a query service. This requires [Docker to be installed](https://docs.docker.com/engine/install) and running locally. The configuration for this container is set from your `docker-compose.yml`

You can observe the three services start, and once all are running (it may take a few minutes on your first start), please open your browser and head to [http://localhost:3000](http://localhost:3000) - you should see a GraphQL playground showing with the schemas ready to query. [Read the docs for more information](https://academy.subquery.network/run_publish/run.html) or [explore the possible service configuration for running SubQuery](https://academy.subquery.network/run_publish/references.html).

## Config yaml
cardano.yaml
```javascript
network:
  chainId: 'cardano'
  networkMagic: 2 # Network Magic of Chain Cardano 
  systemStart: 1666656000000 # System start network 
  slotLength: 1000 # Slot length
dataSources:
  - kind: cardano/Runtime
    startBlock: 2516332 # Start block number
    startSlot: 60589344 # Start slot number
```
cosmoshub.yaml + osmosis.yaml
```javascript
dataSources:
  - kind: cosmos/Runtime
    startBlock: 2137658 # start block number
```
