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

Verifies Docker, Aiken, Deno, Go, and the native Hermes build toolchain on Linux. It does not currently probe Node.js or Rust/Cargo.

### `caribic install`

Installs missing prerequisites on macOS and Ubuntu Linux.

```bash
caribic install
```

### `caribic start [target]`

Starts services. Run `caribic --help` to see an actively maintained exhaustive list of targets and commands.

- **Targets**: `all`, `network`, `bridge`, `gateway`, `dapp`, `relayer`; `mithril` is retained only to return the deprecation error.

Examples:

```bash
caribic start
caribic start --clean
caribic start bridge
caribic start dapp
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

Checks whether key services appear to be up (gateway, cardano, postgres, Yaci, Kupo, Ogmios, Hermes, Osmosis, Redis, cheqd, and Injective). The legacy Mithril check remains available for historical stacks. Use this before running tests if you are unsure about your current state.

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

`caribic demo token-swap` prepares direct Cardano-to-target transfer routes and runs the selected local demo against those direct channel ids.
`caribic demo message-exchange` needs to be reworked per target chain because ICQ/message modules are target-specific.

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
cd caribic
cargo install --path . --force
cd ..
caribic check
caribic install
caribic start --clean
caribic chain start --chain osmosis --network local
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

The test suite is ordered and will **skip** later tests if prerequisites are not met, for example if no direct channel exists or if a known limitation is hit.

- **Test 1**: validates required services are running, including Cardano, Gateway, Hermes, and the selected local target chain.
- **Test 2**: runs the Hermes-native `health-check` to confirm Hermes can connect to the Gateway gRPC endpoint and the direct counterparty chain.
- **Test 3**: reads the handler UTXO and validates an `ibc_state_root` exists and looks sane.
- **Test 4**: creates a Tendermint client for the target chain on Cardano, then checks that the `ibc_state_root` changes.
- **Test 5**: queries client state back via Hermes.
- **Test 6**: updates the Cardano-hosted Tendermint client with new target-chain headers.
- **Test 7**: creates a direct Cardano-to-target IBC connection.
- **Test 8**: creates a direct ICS-20 transfer channel.
- **Test 9**: queries Cardano channel proofs at exact historical heights through Gateway and Hermes before token transfers run.
- **Test 10**: transfers target-chain tokens to Cardano, relays packets, verifies voucher minting and `ibc_state_root` changes, and captures voucher identity for later checks.
- **Test 11**: round-trips that voucher back to the target chain, verifies voucher burn and denom-trace reverse lookup still succeeds.
- **Test 12**: transfers Cardano native `lovelace` to the target chain, verifies Cardano escrow, target-chain voucher minting, and denom-trace reverse lookup.
- **Test 13**: round-trips that target-chain voucher back to Cardano, verifies burn plus unescrow, and checks balance recovery within a fee budget.

### Troubleshooting tips

- The command prints a summary of passed/skipped/failed tests at the end.
- If Test 2 fails, the suite aborts early because the remaining tests depend on Hermes talking to the Gateway.
- Hermes daemon logs are typically written under `~/.hermes/` (see `caribic start` output for the exact log path).
- If you are debugging flakes, rerun with higher verbosity:

```bash
caribic --verbose 5 test
```

## Full Test: Cardano Preprod to Injective Testnet

End-to-end walkthrough for bridging Cardano **preprod** to the **public Injective testnet** (`injective-888`). The public Injective testnet has the Cardano light client registered and allowed, which you can verify with:

```bash
curl -s https://testnet.sentry.lcd.injective.network/ibc/core/client/v1/params
# => {"params":{"allowed_clients":["06-solomachine","07-tendermint","08-cardano-probabilistic"]}}
```

You will need:

- A **funded preprod signing key** (`DEPLOYER_SK`) — it pays for the bridge deployment and doubles as the Hermes `cardano-relayer` key.
- A **funded Injective testnet account** — unfunded accounts return `NotFound` and the IBC handshake fails.
- External preprod **Kupo** and **Ogmios** endpoints (e.g. [Demeter](https://demeter.run)) plus their API keys.

The two keys can be generated and funded with the provisioning scripts in [`caribic/tools/`](tools/README.md) — each script generates (or reuses) the key material under `~/.caribic/`, prints the address together with faucet instructions, and waits until the account is funded:

```bash
deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-preprod-deployer.ts
deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-injective-testnet-key.ts
```

> [!NOTE]
> Why external Kupo/Ogmios? Ogmios speaks the node-to-client protocol over a **local socket**, so it cannot attach to a remote relay — running Ogmios yourself would require the fully synced local node this walkthrough deliberately disables. Kupo can in principle sync from a remote Ogmios (`PREPROD_KUPO_MODE=local` runs local Kupo behind an `ogmios-proxy`), but that mode currently requires compose services that are not fully wired, so `remote` mode with hosted endpoints is the reliable path.

### 1. Create a config that disables the managed local node

In preprod mode nothing consumes the locally managed `cardano-node` follower: Yaci and the Gateway's block-witness fetch talk node-to-node to the external relay (`CARDANO_CHAIN_HOST`), and transactions are built and submitted through the external Kupo/Ogmios endpoints. Skipping the local node saves a full preprod sync (disk and CPU).

Copy the default config **within `caribic/config/`** (relative paths inside it resolve against the config file location) and disable the node service:

```bash
cp caribic/config/default-config.json caribic/config/preprod-config.json
```

In `preprod-config.json` set:

```json
"cardano": {
  "services": {
    "cardano_node": false,
    ...
  },
  ...
}
```

The preprod network profile in the same file already carries the correct protocol magic (`"network_magic": 1`) and chain id (`cardano-preprod`); you do not need to configure the magic anywhere else. Pass the config to **every** caribic invocation below via `--config`.

> [!NOTE]
> Disabling the node requires a caribic build that skips the node readiness probe when the service is off (and a compose file without `postgres → cardano-node` `depends_on`). Both are part of this branch; if `caribic start` still waits on "query cardano-node state" with the node disabled, rebuild the CLI with `cargo install --path caribic --force`.

### 2. Configure the preprod endpoints in the gateway env

`caribic start --network preprod` reads `cardano/gateway/.env` before writing anything and fails fast if the preprod endpoints are missing. Create/extend `cardano/gateway/.env` (start from `.env.example`) with a raw preprod relay and your external Kupo/Ogmios endpoints:

```bash
# Raw preprod relay used by Yaci history sync and gateway block-witness fetch (node-to-node)
CARDANO_CHAIN_HOST=preprod-node.world.dev.cardano.org
CARDANO_CHAIN_PORT=30000

# External Kupo/Ogmios (remote mode); API keys are required in remote mode
PREPROD_KUPO_MODE=remote
KUPO_ENDPOINT=https://<your-project>.preprod-v2.kupo-m1.demeter.run
KUPO_API_KEY=<your-kupo-api-key>
OGMIOS_ENDPOINT=https://<your-project>.preprod-v6.ogmios-m1.demeter.run
OGMIOS_API_KEY=<your-ogmios-api-key>
```

`CARDANO_CHAIN_HOST` must be a raw relay reachable over the node-to-node protocol — caribic rejects `cardano-node` here. The protocol magic (1) is applied automatically from the preprod profile.

**Where the Demeter API keys go:** each Demeter service (Kupo, Ogmios) has its own project key — put them in this same `cardano/gateway/.env` file as `KUPO_API_KEY` and `OGMIOS_API_KEY` (shown above). Remote mode fails fast without both. The Gateway automatically sends them as `dmtr-api-key` headers, and it also accepts Demeter's key-in-hostname URL form (`https://<api-key>.preprod-v2.kupo-m1.demeter.run`) — either style works. Alternatively, export them as `CARIBIC_KUPO_API_KEY` / `CARIBIC_OGMIOS_API_KEY` before `caribic start` and they are written into the env file for you. If you later run the swap dapp (step 8), the same two key values are passed there as `IBC_SWAP_KUPO_API_KEY` / `IBC_SWAP_OGMIOS_API_KEY`.

### 3. Resolve and persist a Yaci checkpoint

Preprod history must sync from a recent checkpoint, never from genesis:

```bash
caribic --config caribic/config/preprod-config.json yaci-checkpoint --network preprod --epochs-back 2 --write-env
```

### 4. Start the preprod runtime and deploy the bridge

```bash
export DEPLOYER_SK=$(cat ~/.caribic/preprod-deployer.sk)   # or your own funded preprod signing key
caribic --config caribic/config/preprod-config.json start --network preprod
```

This starts postgres and the Yaci history services, deploys the IBC validators to preprod (artifacts exported to `manifests/preprod/`), starts the Gateway (gRPC on 5001) and the Hermes daemon, and injects the `injective-888` chain block (public sentry endpoints) into `~/.hermes/config.toml`. Verify with:

```bash
caribic --config caribic/config/preprod-config.json health-check
```

A successful deploy is cached via the artifacts in `manifests/preprod/`; set `CARIBIC_FORCE_PREPROD_DEPLOY=1` to force a redeploy.

### 5. Add the Injective testnet relayer key

> [!IMPORTANT]
> This step requires step 4 to have completed: Hermes refuses to add a key for a chain that is not in `~/.hermes/config.toml`, and it is `caribic start --network preprod` that writes the `injective-888` chain block there. If you run `keys add` first, it fails with an error that only shows Hermes' startup INFO lines. (To stage the key without the full preprod start, `caribic chain start --chain injective --network testnet` also writes just the chain block.)

There is no bundled testnet key. Import your funded account's mnemonic with the Ethermint HD path (Injective uses `ethsecp256k1`, coin type 60). If you used the provisioning script, the mnemonic is at `~/.caribic/injective-testnet.mnemonic`:

```bash
caribic --config caribic/config/preprod-config.json keys add --chain injective-888 \
  --mnemonic-file ~/.caribic/injective-testnet.mnemonic --key-name injective-888-relayer \
  --hd-path "m/44'/60'/0'/0/0" --overwrite
```

No local Injective node is needed — Hermes talks directly to the public testnet sentries.

### 6. Create the route (client, connection, channel)

```bash
caribic --config caribic/config/preprod-config.json setup route --from cardano --to injective --to-network testnet
```

This creates the `08-cardano-probabilistic` client on Injective testnet and the Tendermint client for Injective on Cardano, then opens the connection and the transfer channel, restarting the Hermes daemon around the setup.

### 7. Exercise the route

```bash
caribic --config caribic/config/preprod-config.json demo token-swap --chain injective --network testnet
```

On Injective this runs the direct token-transfer legs (Cardano → Injective and back). A DEX-style swap leg currently exists only for Osmosis (via the `crosschain_swaps` wasm contract).

### 8. Run the swap dapp against preprod + Injective testnet

The IBC swap dapp has a dedicated `testnet` mode for exactly this topology (see `dapps/ibc-swap/client/README.md`):

```bash
cd dapps/ibc-swap/client
cp env .env
```

Set at minimum:

```bash
NEXT_PUBLIC_IBC_SWAP_MODE=testnet
NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT=http://localhost:8000
NEXT_PUBLIC_KUPMIOS_URL=<preprod-kupo-url>,<preprod-ogmios-url>
IBC_SWAP_KUPO_API_KEY=<your-kupo-api-key>
IBC_SWAP_OGMIOS_API_KEY=<your-ogmios-api-key>
```

Then:

```bash
HUSKY=0 yarn && yarn dev
```

(`HUSKY=0` skips the git-hooks install script, which fails inside the monorepo because the dapp client has no `.git` of its own. Also make sure each variable appears only once in `.env` — dotenv keeps the first occurrence, so leftover template placeholders above your real values win.)

The app serves at `http://localhost:3000/swap` (or `http://localhost:3000/<BASE_PATH>/swap` if `BASE_PATH` is set; the root URL redirects there).

To run a transfer in the browser:

1. Open `http://localhost:3000/swap`.
2. Install a Cardano wallet extension (for example VESPR, Eternl, or Lace), switch it to the **preprod** network, and fund the address via the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/).
3. Install a Cosmos wallet extension (for example Keplr or Leap). The dapp suggests the Injective testnet chain to the wallet on connect; approve the "add chain" prompt. Fund the `inj...` address via the [Injective testnet faucet](https://testnet.faucet.injective.network/).
4. Connect both wallets from the header.
5. Wait until the route from step 6 is open and the Hermes daemon is running — the token selector stays empty until the planner finds an open, relayable channel.
6. Pick tADA on the Cardano side, choose the Injective destination, and submit. The transfer completes when the relayer delivers the packet and the voucher balance shows up in the Cosmos wallet (allow a few minutes for preprod stability waits).

Channels and denom traces are discovered at runtime through the planner and the bridge manifest, so the route created in step 6 is picked up automatically. Injective testnet RPC/REST endpoints default to public fallbacks and can be overridden via `NEXT_PUBLIC_INJECTIVE_RPC_ENDPOINT` / `NEXT_PUBLIC_INJECTIVE_REST_ENDPOINT`.

### Keeping the route alive

The Injective-side Cardano client can only be updated with headers whose size and gas grow with the update gap (~4.6–8KB and ~85k gas per preprod block), and update targets must be blocks containing a HostState transaction. In practice this means:

- The Hermes daemon's client refresh must run continuously. After roughly an hour without refreshes, the next catch-up header exceeds Injective's 4MB block limit and the client becomes permanently un-updatable — the route then has to be rebuilt (new client, connection, and channel; `caribic setup route` reuses an existing channel, so a rebuild currently requires driving `hermes create client` / `create connection` / `create channel` manually).
- Anything that pauses the host pauses the refresh loop: laptop sleep, a stopped Gateway container, or a crashed relayer all have the same effect. On macOS, run `caffeinate -dims` while testing, or host the Gateway + Yaci + Hermes stack on an always-on machine for multi-day use.
- The tracked Hermes profile for `injective-888` uses `max_tx_size = 1000000` and `max_gas = 60000000`; the defaults (~205KB / 15M gas) reject even routine ~100-block refresh updates.

What survives a spin-down: the contract deployment (`manifests/preprod/`), all keys, the Yaci history volume, and — within its 10-day trusting period — the Cardano-side Tendermint client, which catches up with a single header regardless of gap. What does not: the Injective-side client, and with it the connection and channel. To restart after downtime:

1. `caribic start --network preprod` (reuses the deployment) and wait until `/health/ready` reports `ready`.
2. `hermes update client --host-chain cardano-preprod --client <07-tendermint-N>` — this revalidates the reusable client and mints a fresh HostState anchor. Wait for `proofHeight` to advance to it (~8 minutes). New clients anchor at the latest HostState tx block, so skipping this step creates the Injective-side client hours in the past, where no reachable update target exists.
3. `hermes create client --host-chain injective-888 --reference-chain cardano-preprod`, then `hermes create connection` (reusing the Cardano-side client) and `hermes create channel` (`caribic setup route` reuses the existing dead channel, so the rebuild needs the explicit Hermes commands).
4. Restart the relayer daemon before testing.

### Troubleshooting

- Hermes only reads `~/.hermes/config.toml` at startup — after manual config changes run `caribic stop relayer` then `caribic start relayer --network preprod`.
- A Gateway that dies with an unhandled WebSocket error (visible via `docker logs gateway-app`) has lost its remote Kupo/Ogmios connection; restart it with `docker start gateway-app`. Until it is back, Hermes reports Cardano queries as `Configuration error: wrong configuration type`.
- `caribic keys add --chain injective-888` failing with output that ends after Hermes' INFO startup lines means the `injective-888` chain block is missing from `~/.hermes/config.toml` — complete step 4 first (see the note in step 5).
- `NotFound` account errors on Injective mean the relayer address is unfunded.
- Hermes errors like `unknown header type: /ibc.lightclients.probabilistic.v1.ProbabilisticHeader` mean the compiled relayer binary is older than the `relayer/` submodule checkout — rebuild it with `cd relayer && cargo build --release --bin hermes`. (Hermes reports errors on stdout, so caribic may show such failures with an empty message.)
- If client creation on Injective fails with an unsupported client type, re-check the `allowed_clients` query at the top of this section.
