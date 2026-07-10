# Cardano Network Services

This directory contains the Docker Compose configuration and runtime inputs for
the Cardano side of the local bridge environment. Use the `caribic` CLI from the
repository root to manage these services; it generates and validates the
required environment and runtime files.

## Local Network

Install `caribic` once:

```bash
cd caribic
cargo install --path . --force
cd ..
```

Start or stop only the Cardano network services:

```bash
caribic start network --network local
caribic stop network
```

To start the complete local bridge stack, including deployment, Gateway, and
Hermes, run:

```bash
caribic start
```

Direct `docker compose` commands are useful for debugging the service
definitions, but they bypass the setup and validation performed by `caribic`.

## Preprod

Preprod Yaci Store starts from an explicit recent checkpoint. Generate and
persist it before starting the network:

```bash
caribic yaci-checkpoint --network preprod --epochs-back 2 --write-env
caribic start network --network preprod
```

The checkpoint command writes `YACI_SYNC_START_SLOT`,
`YACI_SYNC_START_BLOCKHASH`, and `YACI_SYNC_START_BLOCK_NO` to the local
environment files.

## Stake Pools

The helper scripts expect to run from this directory:

```bash
cd chains/cardano
./regis-spo.sh alice
./deregis-spo.sh alice
```

The first command registers a local stake pool. The second submits its
retirement certificate for the configured retirement epoch.

See the root [README](../../README.md) and the [`caribic` guide](../../caribic/README.md)
for the complete bridge workflow and command inventory.
