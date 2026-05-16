# Caribic

`caribic` is a local CLI used to bootstrap, run, and validate the Cardano <-> IBC bridge demo environment in this repo. For those familiar with Hermes, caribic cli also wraps that interface with equivalent commands that allow manual interaction with the relayer. The expected workflow is that keys would be addded to hermes via caribic, i.e, either you can enter via I/O when prompted, or refer to a mnemonic file as prompted, but there is no need to manually configure hermes. 

> [!WARNING]
> Mithril setup is deprecated, disabled, and not maintained. `caribic start --with-mithril` and `caribic start mithril` now fail fast; use the default stake-weighted-stability light-client mode.

## Build and run

From `cardano-ibc-incubator/caribic`:

```bash
cargo install --path .
```
## Commands overview

### `caribic check`

Verifies prerequisites are available (Docker, Aiken, Deno, Go).

### `caribic install`

Installs missing prerequisites on macOS and Ubuntu Linux.

```bash
caribic install
```

### `caribic start [target]`

Starts services. Run `caribic --help` to see an actively maintained exhaustive list of targets and commands.

Examples:

```bash
caribic start
caribic start --clean
caribic start bridge
caribic chain start --chain osmosis
caribic chain start --chain injective --network local
caribic chain start --chain injective --network testnet
```

Preprod Yaci checkpoint note:
- `caribic start --network preprod` requires Yaci to start from an explicit recent checkpoint, not genesis.
- Generate and persist a checkpoint before deploying bridge contracts:

```bash
caribic yaci-checkpoint --network preprod --epochs-back 2 --write-env
caribic start network --network preprod
```

- This writes `YACI_SYNC_START_SLOT`, `YACI_SYNC_START_BLOCKHASH`, and `YACI_SYNC_START_BLOCK_NO` into the local env files. Resolve these once; do not keep them as a moving "relative to now" value.

Injective startup note:
- `caribic chain start --chain injective --network local` starts a local single-node Injective devnet.
- `caribic chain start --chain injective --network testnet` starts a local `injectived` process bootstrapped from a public Injective testnet snapshot.
- `caribic chain start --chain injective --network mainnet` is intentionally not implemented yet.
- If `injectived` is missing, caribic prompts to install it from source (`InjectiveFoundation/injective-core`) and runs `make install`.

Hermes config note:
- Hermes reads `~/.hermes/config.toml` when the process starts. Editing that file while Hermes is already running does not apply live.
- If you change Hermes config manually, restart Hermes (`caribic stop relayer` then `caribic start relayer`).
- `caribic` writes Hermes config during setup and, for `caribic demo token-swap`, augments it with the `localosmosis` chain block before Hermes is used for channel creation.

### `caribic stop [target]`

Stops services. With no target, it behaves like `all`.

- **Targets**: `all`, `network`, `bridge`, `demo`, `gateway`, `relayer`, `mithril`

Examples:

```bash
caribic stop
caribic stop bridge
caribic chain stop --chain osmosis
caribic chain stop --chain injective --network local
caribic chain stop --chain injective --network testnet
```

### `caribic chain <start|stop|health> --chain <id>`

Manages optional chains through the adapter registry. This is the canonical interface for non-core chains such as Osmosis, cheqd, and Injective.

```bash
caribic chain start --chain osmosis
caribic chain start --chain injective --network testnet --chain-flag stateful=false
caribic chain health --chain cheqd --network testnet
caribic chain stop --chain injective --network local
```

### `caribic health-check [--service <name>]`

Checks whether key services appear to be up (gateway, cardano, postgres, kupo, ogmios, hermes, mithril, cosmos, osmosis, redis, plus optional chain adapter checks such as Injective). Use this before running tests if you are unsure about your current state.

```bash
caribic health-check
caribic health-check --service gateway
```

### `caribic audit`

Runs three checks and reports a single pass or fail summary:
- `npm audit` in `cardano/gateway`
- `cargo audit` in `caribic`
- `aiken check` in `cardano/onchain`

### `caribic keys <add|list|delete>`

Convenience wrapper around Hermes keyring operations.

```bash
caribic keys list
caribic keys add --chain localosmosis --mnemonic-file ./my-mnemonic.txt --overwrite
caribic keys add --chain injective-888 --mnemonic-file ./injective.txt --key-name injective-888-relayer --hd-path "m/44'/60'/0'/0/0" --overwrite
caribic keys delete --chain localosmosis --key-name relayer
```

### `caribic create-client`, `caribic create-connection`, `caribic create-channel`

Thin wrappers that run the corresponding Hermes IBC actions using the local Hermes binary/config.

```bash
caribic create-client --host-chain cardano-devnet --reference-chain localosmosis
caribic create-connection --a-chain cardano-devnet --b-chain localosmosis
caribic create-channel --a-chain cardano-devnet --b-chain localosmosis --a-port transfer --b-port transfer
```

### `caribic demo <message-exchange|token-swap>`

Direct-route demo automation is disabled until direct Cardano-to-target IBC routes are implemented.
`caribic demo token-swap` and `caribic demo message-exchange` fail closed instead of routing through an intermediary chain.

The deprecated Mithril readiness settings remain in the config only for historical compatibility and are not part of the maintained startup path.
If your machine is slower, tune retry windows in `caribic/config/default-config.json` (or whichever file you pass via `--config`).

Operator-facing retry/timeout tuning is configurable in one place: `caribic/config/default-config.json` by default.
For example:

```json
{
  "health": {
    "cosmos_max_retries": 60,
    "cosmos_retry_interval_ms": 10000,
    "gateway_max_retries": 180,
    "gateway_retry_interval_ms": 2000
  },
  "demo": {
    "mithril_artifact_max_retries": 240,
    "mithril_artifact_retry_delay_secs": 5,
    "message_exchange": {
      "consolidated_report_max_retries": 40,
      "consolidated_report_retry_delay_secs": 3,
      "channel_discovery_max_retries": 20,
      "channel_discovery_max_retries_after_create": 120,
      "channel_discovery_retry_delay_secs": 3,
      "connection_discovery_max_retries": 20,
      "connection_discovery_retry_delay_secs": 3,
      "mithril_readiness_progress_interval_secs": 30,
      "relay_max_retries": 20,
      "relay_retry_delay_secs": 3
    }
  }
}
```

These values are read directly from the selected config file (default: `caribic/config/default-config.json`).
If the default config file is missing, caribic fails fast at startup.
If a required key is missing or set to `0`, caribic now fails fast with an explicit config error.

## `caribic test`

Runs end-to-end integration tests that validate the bridge plumbing from the outside, using Hermes to drive the gRPC Gateway and verifying on-chain effects via the Cardano handler state root. The general workflow to run the tests would be 

```bash 
cd caribic && cargo install --path . --force && cd .. && caribic check && caribic install && caribic start --clean
```

then wait for services to boot up, then 

```bash
caribic health-check
```

to make sure all the services are healthy, then 

```bash
  caribic test
  ```

### What it tests

The previous route-chain integration tests have been retired. `caribic test` now reports that direct-route integration coverage must be rebuilt once Cardano-to-target clients, connections, and channels exist.

### Troubleshooting tips

- The command prints a summary of passed/skipped/failed tests at the end.
- If Test 2 fails, the suite aborts early because the remaining tests depend on Hermes talking to the Gateway.
- Hermes daemon logs are typically written under `~/.hermes/` (see `caribic start` output for the exact log path).
- If you are debugging flakes, rerun with higher verbosity:

```bash
caribic --verbose 5 test
```
