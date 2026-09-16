# Local Cardano network

This directory contains the Cardano node, Ogmios, Kupo, and Yaci-backed history
runtime configuration used by [Caribic](../../caribic/README.md). The maintained
local devnet is defined in [docker-compose.yaml](docker-compose.yaml). Caribic
prepares the runtime files and Compose environment before starting services.

## Start the devnet

See the root [prerequisites](../../README.md#prerequisites) for the required
toolchain. From the repository root, install Caribic and check its prerequisites:

```sh
cargo install --path caribic
caribic check
```

Start the local Cardano network:

```sh
caribic start network
```

To start the complete local bridge stack from a clean state, use:

```sh
caribic start --clean
```

`--clean` resets the local environment. See the
[Caribic command reference](../../caribic/README.md#commands-overview) for starting
individual bridge components and selecting public Cardano networks.

## Genesis and runtime configuration

The local genesis template is
[config/devnet/genesis-shelley.json](config/devnet/genesis-shelley.json), and
Caribic prepares the local runtime under `chains/cardano/devnet/`. The
`activeSlotsCoeff` and `slotLength` genesis fields control block-production
opportunities and slot duration. Change genesis settings before initializing a
fresh devnet; use a clean start to apply them to an existing local environment.

Protocol capacities and their clean-state requirements are documented in
[Caribic network limits](../../docs/caribic-network-limits.md). Local account and
bootstrap-address settings live in Caribic's configuration; see
[Local account configuration](../../README.md#local-account-configuration).

## Inspect the running local node

From any directory, query the container started by Caribic. The local devnet uses
network magic `42`:

```sh
docker exec cardano-node cardano-cli query tip --testnet-magic 42
docker exec cardano-node cardano-cli query stake-snapshot --all-stake-pools --testnet-magic 42
```

## Stake-pool helper scripts

The local stake-pool scripts live in this directory:
[regis-spo.sh](regis-spo.sh) and [deregis-spo.sh](deregis-spo.sh). From the
repository root, register a pool with:

```sh
cd chains/cardano && ./regis-spo.sh alice
```

To request retirement in the next epoch, run from the repository root:

```sh
cd chains/cardano && ./deregis-spo.sh alice
```

These scripts use local devnet paths and network magic `42`.
