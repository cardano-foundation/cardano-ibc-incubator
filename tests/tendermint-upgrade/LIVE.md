# Local revision upgrade rehearsal

This rehearsal uses the supported v8 application and an isolated magic-42 Cardano network. A revision change is an operator procedure layered on the SDK upgrade-store commitments. It exports the old application state and imports it under `v8-classic-2` at height `1`. It does not model Injective's binary or its operator procedure.

The Cardano history comes from a cold pre-IBC checkpoint accepted by `restore-migration-checkpoint.py`. Its blocks and pool history remain intact. `prepare_live.py` restores new Docker volumes and assigns loopback ports. A fresh deployment uses the currently compiled contracts. The saved deployment is not reused. The runtime must be under `.deployment-smoke` and the Compose project must start with `cardano-deployment-test-`.

The local Mithril test signer server certifies the stake distribution captured from this actual ledger. Production Mithril services are not exercised. The Cardano ledger, execution limits, consensus checks and probabilistic client verifier are unchanged. The clock offset aligns the owned services with the checkpoint. The host clock is not changed.

Build the Gateway and its workspace dependencies. Build Hermes from the pinned `relayer` submodule. Compile the silent blueprint with Aiken `1.1.24`. The local binaries also require Python, Node, Deno, Go `1.26.9`, Docker and `faketime`. Keep runtime files and key directories out of version control.

Build `chains/cosmos/Dockerfile` using the pinned v8 Compose build arguments with `LOCAL_FIXTURE_CLOCK=1`. Tag its runtime `local:cardano-ibc-918-cosmos` and its `builder` target `local:cardano-ibc-918-cosmos-builder`. Then build the old application:

```sh
docker build -f tests/tendermint-upgrade/Dockerfile.cosmos-old \
  -t local:cardano-ibc-918-cosmos-old .
```

The old binary omits future upgrade handlers. The successor contains them. The SDK rejects a binary that already has the scheduled handler before the halt height. Use plan name `v8.1`. The historical `v8` plan also installs a circuit store that already exists in a chain born on v8. The optional intermediate image in the Dockerfile is only for recovery of the retained diagnostic run that first exposed this fixture mistake.

Prepare a new runtime from an explicitly selected mature checkpoint:

```sh
runtime="$PWD/.deployment-smoke/cardano-deployment-test-918upgrade"
hermes="$PWD/relayer/target/debug/hermes"
python3 tests/tendermint-upgrade/prepare_live.py \
  --checkpoint /absolute/path/to/mature-checkpoint --runtime "$runtime"
docker compose -p cardano-deployment-test-918upgrade \
  -f "$runtime/compose.json" up -d
python3 tests/tendermint-upgrade/live.py deploy --runtime "$runtime"
```

Build the local signer server from `cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest/cmd/aggregator`. Run it through `live.py local-signers --runtime "$runtime" --mithril-binary /absolute/path/to/binary` in a retained terminal. That command captures the canonical epoch stake snapshot. It converts ledger pool hashes into the bech32 pool identifiers expected by the normal verifier. Its URL and certificates stay in the owned runtime.

Start `live.py gateway --runtime "$runtime"` in another retained terminal. Export the fresh deployment manifest and initialize the isolated relayer keys:

```sh
python3 tests/tendermint-upgrade/live.py export-manifest --runtime "$runtime"
python3 tests/tendermint-upgrade/live.py setup-hermes --runtime "$runtime" \
  --hermes-binary "$hermes"
python3 tests/tendermint-upgrade/live.py hermes --runtime "$runtime" \
  --hermes-binary "$hermes" -- create channel \
  --a-chain cardano-devnet --b-chain v8-classic-1 \
  --a-port transfer --b-port transfer --new-client-connection --yes
```

Record both chains' actual client, connection and channel identifiers. Send and receive an ICS-20 packet and relay its successful acknowledgement. Verify the destination voucher balance. Send another packet and leave its commitment pending. Retain an observation with `live.py observe --runtime "$runtime" --out "$runtime/before-upgrade.json"`. The observer reads raw protocol datums from Kupo and checks their current output references against the actual ledger. It also captures packet lanes, wallet assets and the Cosmos route state.

Schedule an upgrade at least thirty blocks ahead with `live.py upgrade-plan --upgrade-height H --upgrade-name v8.1 --runtime "$runtime"`. This submits a normal IBC upgrade governance proposal using the validator fixture account. It checks the committed result and saves its proposal identifier. Run `live.py vote-upgrade --runtime "$runtime"` to vote yes on that proposal and check the committed vote. Wait for the proposal to pass and the old binary to halt at `H`. Keep the old home and signing journal.

```sh
python3 tests/tendermint-upgrade/capture_upgrade.py \
  --runtime "$runtime" --upgrade-height H
python3 tests/tendermint-upgrade/live.py hermes --runtime "$runtime" \
  --hermes-binary "$hermes" -- upgrade client --host-chain cardano-devnet \
  --client 07-tendermint-0 --upgrade-height H
```

The capture includes the signed header at `H`, its validator set and the two actual SDK proofs from store version `H-1`. The SDK halt has no subsequent block from which to read a canonical commit record. The capture therefore verifies the seen commit's signatures and checks that the application actually stopped at `H-1`. The reference keeper must accept the proofs before the capture is saved.

Inspect the actual Cardano upgrade transaction and datum. The existing client NFT must remain the same. Its chain ID and height must become `v8-classic-2` and `(2, 1)`. Its sole bootstrap consensus root must be `sentinel_root`. The restart uses `successor_cosmos_image` from `upgrade-profile.json`:

```sh
python3 tests/tendermint-upgrade/restart_revision.py --runtime "$runtime"
python3 tests/tendermint-upgrade/live.py resume-hermes --runtime "$runtime" \
  --hermes-binary "$hermes"
```

The restart refuses to proceed before it observes that on-ledger bootstrap state. It exports through the SDK and preserves the IBC genesis value. Only the genesis chain ID, initial height and time change afterward. A fresh home receives the export and the same validator key. The old home remains untouched. A new signing journal belongs only to the different chain ID. The first successor block must have the expected validator hash.

Before a verified Tendermint update, try valid membership and absence proofs through the actual Gateway using proof height `(2, 1)`. `gateway-tx.cjs` builds explicit receive and pruning requests and retains errors. It broadcasts only with `--submit`. Confirm that the proof policy rejects the bootstrap root. Then relay a verified successor header above height `1`. Confirm that the authenticated application root is installed and normal packet proofs succeed. Receive the carried packet, submit another transfer and relay both acknowledgements. Prune the pre-upgrade receipt using a real absence proof to exercise non-membership after the update.

Compare the retained observations and actual transaction receipts. The client NFT, both connection ends and both channel ends must keep their identities. Check successful acknowledgements and token balances rather than treating a submitted transaction as delivery. A failed or interrupted run must retain its runtime and submitted transaction hashes for reconciliation before retrying.

The public diagnostic capture can be rechecked without either chain running:

```sh
python3 tests/tendermint-upgrade/verify_capture.py \
  tests/tendermint-upgrade/evidence/v8-diagnostic-upgrade-proof.json
```

That diagnostic proof has a kernel timestamp `5,021,698,904` nanoseconds earlier than its authenticating header. It is the regression that required the timestamp fix. It establishes reference proof acceptance. It does not by itself establish a completed Cardano transaction, resumed packet traffic or an independent security review.
