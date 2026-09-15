# Probabilistic software-upgrade fixtures

These fixtures implement the checks in the
[compatibility contract](../../docs/probabilistic-client-software-upgrades.md).
They do not edit or publish the light-client Go modules.

See the [verification record](./evidence/README.md) for the measured results and
the live environment blocker encountered during implementation.

## Published-module store test

From the repository root:

```sh
python3 tests/probabilistic-upgrade/run_store_compatibility.py \
  --major 8 --output /tmp/upgrade-store-v8
python3 tests/probabilistic-upgrade/run_store_compatibility.py \
  --major 10 --output /tmp/upgrade-store-v10
```

Requires Python 3, Go with toolchain auto-download/network access, and a C
compiler for the SDK dependencies. Each output directory must be new.

`releases.json` pins adapter v8 `v0.1.7`, adapter v10 `v0.1.4`, and core `v0.1.5`
to release commit `e232bfd422084aed79a0a88ae876e863b1190cff`. The consumer modules
are temporary and independent of repository Go modules/workspaces. The runner
checks Go-proxy origin commits and rejects replacement directives in the
resolved graph. It saves module checksums, the complete graph and binary build
information in the evidence directory.

Two different host executables, distinguished by a fixture version string,
use the **same released module versions**. The first initializes and commits
two client stores to a real IAVL/LevelDB database. The second reopens it and
checks:

- stable client type and five protobuf type URLs;
- persisted client/consensus state and message decoding;
- valid membership and non-membership proofs using nonzero time/block delays;
- unchanged complete client-store bytes across process replacement;
- rejection of an incompatible type URL and an unmigrated processed-time key
  rename, with neither negative check modifying the persisted database;
- rejection of a still-decodable client whose mandatory clock parameter is
  absent, demonstrating that wire compatibility alone is insufficient;
- successful verification again after those rejected checks.

The message fixtures exercise decoding only; their placeholder header CBOR is
not an authenticated update. Synthetic committed roots exercise the real proof
verifier but are not live ICS-20 transfers. This control proves that host binary
replacement does not inherently require a new module release. It does not
prove compatibility between two different verifier implementations, exercise
the full host upgrade handler, or validate the current checkout's newer rules.

## Live v8/v10 Classic scenario

### Build two hosts from the existing release

```sh
python3 tests/probabilistic-upgrade/build_live_images.py \
  --major 8 --image-prefix local/cardano-ibc-upgrade-v8
```

The build archives only the pinned release's core/v8/v10 source directories,
then uses the repository's existing simd integration recipe. It generates
`:before` and `:after` images with different SDK version strings and identical
released light-client source. The local profile recipe copies the client into
simapp and rewrites its Go imports; the image manifest records the source
release used. This is not an independently published adapter module or an
Injective binary. The store test above separately checks the actual public Go
module graph without copied sources.

The pinned release commit and annotated tags must be present locally (fetch
the repository tags if using a shallow clone). The builder checks tag targets
before archiving. The live controller chooses a fresh genesis timestamp and
waits for two committed blocks before client creation, so a new Tendermint
client cannot accidentally start with an already-expired genesis timestamp.

### Prepare the relayer and Cardano environment

Use a local Cardano deployment with its matching Gateway and Hermes. Configure
a dedicated Hermes configuration/key home for the new Cosmos chain, with no
background relayer updating it during replacement. Use the
[Classic profile configuration](../../chains/cosmos/README.md) and public local
relayer mnemonic in `docker_host.py`. Point its Cosmos RPC, gRPC and REST
addresses at ports `27757`, `9200` and `1427`. The fixture creates the client,
connection and transfer channel itself; do not pre-create a route.

Set `HERMES_BIN` to an executable wrapper that invokes your built Hermes with
that configuration (global `--config` before the remaining arguments). For
example, with absolute paths:

```sh
#!/bin/sh
exec /path/to/hermes --config /path/to/upgrade-hermes.toml "$@"
```

Use a unique Cosmos chain ID such as `upgrade-v8-1` in both that configuration
and the environment below. Fund/import the configured Cardano relayer key as
usual. `HANDLER_JSON` must describe that same running deployment, including its
mock token. The existing direct-transfer script verifies packet acknowledgement
and cleared commitments.

### Run the upgrade

```sh
export COSMOS_PROFILE=v8-classic
export COSMOS_CHAIN_ID=upgrade-v8-1
export CARDANO_CHAIN_ID=cardano-devnet
export UPGRADE_CONTAINER=cardano-ibc-upgrade-v8-check
export UPGRADE_STATE_DIR="$HOME/.caribic/upgrade-v8-state"
export UPGRADE_EVIDENCE_DIR=/tmp/cardano-ibc-upgrade-v8-live
export UPGRADE_BEFORE_IMAGE=local/cardano-ibc-upgrade-v8:before
export UPGRADE_AFTER_IMAGE=local/cardano-ibc-upgrade-v8:after
export UPGRADE_CONTROL_SCRIPT="$PWD/tests/probabilistic-upgrade/docker_host.py"
export SIMD_BIN="$UPGRADE_CONTROL_SCRIPT"
export HERMES_BIN=/absolute/path/to/upgrade-hermes-wrapper
export HANDLER_JSON=/absolute/path/to/deployments/handler.json
bash chains/cosmos/scripts/run_light_client_upgrade.sh
```

The state and evidence directories must not exist. The Docker controller uses
its own container and bind-mounted state directory; it does not operate on
existing Compose profiles. The state path must be shared with the Docker daemon
(particularly on macOS). Host ports can be changed with `UPGRADE_RPC_PORT`,
`UPGRADE_GRPC_PORT` and `UPGRADE_REST_PORT`, with matching Hermes changes. Repeat
with `--major 10`, `v10-classic`, a new chain ID, image prefix and directories
for v10. Run profiles sequentially when reusing those ports.

The controller starts the old host, then the scenario creates a fresh route
and completes a transfer. It records the running executable hash, image ID and
source-module manifest, and snapshots client/route state, sequence counters,
packet commitments and voucher denomination/trace/balance. It stops the host,
replaces its executable, and restarts on the **same database**. Before any new
transfer it requires the snapshots to match. It then requires a second transfer
to advance the original client's root-bearing height and checkpoint while
retaining the original route, denomination and Cardano client list. It also
checks that the Cardano deployment descriptor has not changed.

By default, changed adapter/core versions fail the scenario
(`UPGRADE_REQUIRE_SAME_MODULES=true`). Set this to `false` only for a deliberately
selected old/new release pair with its separately reviewed compatibility and
migration decision. It does not disable any state or packet assertions.

Evidence is retained on success and failure. `PASS` is written only after all
checks complete. Container logs and transfer logs help diagnose a failed run.
The fixture leaves its container/data available for inspection; remove only
that named test container when finished:

```sh
docker stop "$UPGRADE_CONTAINER"
docker rm "$UPGRADE_CONTAINER"
```

A successful restart control does not demonstrate governance scheduling or a
real application-state migration. Those require the exact candidate host's
upgrade handler. For a host that deliberately migrates state, extend the
snapshot comparison with an explicit reviewed transformation; do not broadly
ignore client-state differences.

### Other host binaries and #603

`UPGRADE_CONTROL_SCRIPT` is an executable with three actions:

- `start`: start the selected old host on an empty isolated database and wait
  for readiness;
- `identity`: emit one JSON object with `binary_sha256` and `modules.adapter`
  and `modules.core`, each containing immutable `version` and `commit` fields;
- `upgrade`: execute the host-specific coordinated replacement/migration and
  return only when the replacement is ready on the retained database.

The provided controller derives the hash from the container's executable and
gets the source manifest from the immutable running image. For production
qualification, derive the module identity from the actual candidate build and
record the full replacement graph. `SIMD_BIN` is the separate executable used
for local-profile CLI queries. The shared assertions currently expect the
simd `cosmos` address prefix and Classic profile denomination queries; an
Injective rehearsal must adapt those CLI/address details to the selected
binary. Use the equivalent acceptance gate documented in the
[contract](../../docs/probabilistic-client-software-upgrades.md#verification-and-the-603-acceptance-gate).

## Orchestration tests

```sh
python3 -m unittest discover -s tests/probabilistic-upgrade -p 'test_*.py' -v
```

These run the live shell scenario with mocked command executables. They cover
both profiles and reject unchanged binaries, changed modules, retargeted
connections, additional Cardano clients, lost balances, new denominations,
missing client advancement and failed transfers. They prove the harness fails
when these conditions occur; they do not prove a live chain upgrade passed.
