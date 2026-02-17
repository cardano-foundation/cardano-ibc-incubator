# Caribic

`caribic` is a local CLI used to bootstrap, run, and validate the Cardano <-> IBC bridge demo environment in this repo. For those familiar with Hermes, caribic cli also wraps that interface with equivalent commands that allow manual interaction with the relayer. The expected workflow is that keys would be addded to hermes via caribic, i.e, either you can enter via I/O when prompted, or refer to a mnemonic file as prompted, but there is no need to manually configure hermes. 

## Build and run

From `cardano-ibc-incubator/caribic`:

```bash
cargo install --path .
```
## Commands overview

### `caribic check`

Verifies prerequisites are available in your `PATH` (Docker, Aiken, Deno, Go, Hermes) and can also bootstrap `osmosisd` when needed.

### `caribic start [target]`

Starts services. Run `caribic --help` to see an actively maintained exhaustive list of targets and commands.

Examples:

```bash
caribic start
caribic start --clean --with-mithril
caribic start bridge
caribic start cosmos --clean
caribic start osmosis
```

Hermes config note:
- Hermes reads `~/.hermes/config.toml` when the process starts. Editing that file while Hermes is already running does not apply live.
- If you change Hermes config manually, restart Hermes (`caribic stop relayer` then `caribic start relayer`).
- `caribic` writes Hermes config during setup and, for `caribic demo token-swap`, augments it with the `localosmosis` chain block before Hermes is used for channel creation.

### `caribic stop [target]`

Stops services. With no target, it behaves like `all`.

- **Targets**: `all`, `network`, `bridge`, `cosmos`, `osmosis`, `demo`, `gateway`, `relayer`, `mithril`

Examples:

```bash
caribic stop
caribic stop bridge
caribic stop osmosis
```

### `caribic health-check [--service <name>]`

Checks whether key services appear to be up (gateway, cardano, postgres, kupo, ogmios, hermes, mithril, cosmos, osmosis, redis). Use this before running tests if you are unsure about your current state.

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
Note: the Cosmos Entrypoint chain currently uses the Hermes chain id `sidechain`.

```bash
caribic keys list
caribic keys add --chain sidechain --mnemonic-file ./my-mnemonic.txt --overwrite
caribic keys delete --chain sidechain --key-name relayer
```

### `caribic create-client`, `caribic create-connection`, `caribic create-channel`

Thin wrappers that run the corresponding Hermes IBC actions using the local Hermes binary/config.
The Entrypoint chain is still addressed as `sidechain` at the Hermes layer.

```bash
caribic create-client --host-chain cardano-devnet --reference-chain sidechain
caribic create-connection --a-chain cardano-devnet --b-chain sidechain
caribic create-channel --a-chain cardano-devnet --b-chain sidechain --a-port transfer --b-port transfer
```

### `caribic demo <message-exchange|token-swap>`

Starts a demo setup step on top of already running services.
`caribic demo token-swap` expects `caribic start --with-mithril` and `caribic start osmosis` to have already been run. It then validates required services, prepares Hermes channels, deploys the cross-chain swap contracts, and executes the swap flow end-to-end.

## `caribic test`

Runs end-to-end integration tests that validate the bridge plumbing from the outside, using Hermes to drive the gRPC Gateway and verifying on-chain effects via the Cardano handler state root. The general workflow to run the tests would be 

```bash 
cd caribic && caribic install --path . && caribic stop && caribic start --clean --with-mithril
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

The test suite is ordered and will **skip** later tests if prerequisites are not met (for example if no channel exists, or if a known limitation is hit).

- **Test 1**: validates required services are running (Cardano, Gateway container, Cosmos entrypoint RPC, Mithril endpoints and readiness checks)
- **Test 2**: runs the Hermes-native `health-check` to confirm Hermes can connect to the Gateway gRPC endpoint and query latest height
- **Test 3**: reads the handler UTXO and validates an `ibc_state_root` exists and looks sane
- **Test 4**: `createClient` via Hermes -> Gateway -> Cardano, then checks the `ibc_state_root` changes
- **Test 5**: queries client state back via Hermes, may skip if the Gateway requires an explicit height parameter
- **Test 6**: updates the client with new Tendermint headers, may skip if there are no new blocks or if height handling is required
- **Test 7**: creates an IBC connection, may skip if the Cosmos-side Cardano light client pieces are not available yet
- **Test 8**: creates an ICS-20 transfer channel, depends on Test 7 establishing a connection
- **Test 9**: ICS-20 transfer from the entrypoint chain to Cardano, relays packets, verifies voucher minting and `ibc_state_root` changes, and captures voucher identity for later checks
- **Test 10**: round-trip of that voucher back to the entrypoint chain, verifies voucher burn and denom-trace reverse lookup still succeeds
- **Test 11**: ICS-20 transfer of Cardano native `lovelace` to the entrypoint chain (Cardano escrows, Cosmos mints voucher), verifies denom-trace reverse lookup
- **Test 12**: round-trip of that voucher back to Cardano (burn + unescrow), verifies `ibc_state_root` changes and balance recovery within a fee budget

### Troubleshooting tips

- The command prints a summary of passed/skipped/failed tests at the end.
- If Test 2 fails, the suite aborts early because the remaining tests depend on Hermes talking to the Gateway.
- Hermes daemon logs are typically written under `~/.hermes/` (see `caribic start` output for the exact log path).
- If you are debugging flakes, rerun with higher verbosity:

```bash
caribic --verbose 5 test
```
