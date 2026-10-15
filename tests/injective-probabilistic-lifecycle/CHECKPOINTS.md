This replay requires the combined light client release with #908, #911 and #913 and Hermes #44 and #45. It uses the normal Hermes refresh worker and misbehaviour watcher with the production Cardano and Cosmos chain endpoints. Gateway runs its real `QueryService` header builder behind gRPC. The external Cardano history and block-body services are replaced with deterministic signed history. Header signatures and body commitments are verified by the native Injective application. The synthetic Cardano transactions have not been admitted by a Cardano ledger.

The destination is the pinned `InjectiveApp` from `v1.18.0-1770939123` at `6632cef271f7482f39f9c5d4b085adc1370e8b7e`. The public testnet capacity profile retains its captured 75 million gas per transaction and 150 million gas per block. An isolated CometBFT copy advances committed destination time by eight seconds per proposed block. The client still enforces its ten second maximum committed gap. The clock patch is confined to the disposable test image. Pausing acceleration leaves normal time and block production running.

Prepare a fresh directory shared with Docker. This builds the pinned application and native message helper and exports the signed history using the combined release's codecs. Node.js dependencies and the local protobuf and runtime packages must already be built as for Gateway's ordinary tests.

```sh
tests/injective-probabilistic-lifecycle/prepare_checkpoint.sh "$OUTPUT"
cargo build --locked --bins --manifest-path tests/challenge-capacity-relayer/Cargo.toml
```

Run the primary and independent witness Gateway processes in separate terminals from `cardano/gateway`. Use ports `15001` and `15002` for the legacy run. Set `CHECKPOINT_GATEWAY_WITNESS=1` only on the witness process. Each process writes a ready file after binding. The checked-in manifest contains public fixture addresses for endpoint initialization.

```sh
CHECKPOINT_ACCEPTANCE_DIR="$OUTPUT" CHECKPOINT_GATEWAY_PORT=15001 \
  node node_modules/jest/bin/jest.js --config package.json --runInBand --coverage=false \
  --runTestsByPath src/query/test/query.service.stability-anchor-contract.spec.ts \
  --testNamePattern 'serves signed idle history'
```

From the repository root run both phases. `WORKER` is the absolute path to the compiled `checkpoint-worker` binary. The first phase opens a route and sends one outbound packet before the idle interval. It then leaves the route idle for more than the 96 hour trusting period. There is no newer `HostState` root until the second phase. The refresh worker selects and commits checkpoints across epoch boundaries. The driver restarts Hermes after 100 hours. A separate client remains unmaintained so it actually expires. A third client is maintained as an authorized recovery substitute.

```sh
python3 tests/injective-probabilistic-lifecycle/run_checkpoint.py "$OUTPUT" \
  --auto-clock --profile-suffix auto --maintain-substitute --data-volume auto \
  --worker "$WORKER" --manifest "$OUTPUT/fixture-manifest.json"
python3 tests/injective-probabilistic-lifecycle/run_checkpoint_lifecycle.py "$OUTPUT" \
  --worker "$WORKER"
```

Repeat from a fresh output directory for compact storage. Pass `--mode compact --rpc-port 18958 --grpc-port 19091` to both Python commands. Also pass `--gateway-port 15011` to the first command and use Gateway ports `15011` and `15012`.

The second phase reopens the native store and exports and imports the application at the retained host height. It compares the retained root and its original processing metadata. It receives a valid packet at that root and rejects an early timeout despite newer checkpoint progress. The real watcher submits conflicting signed history and freezes the active client after the original root's trusting period. Ordinary checkpoints cannot unfreeze it. The substitute then gains a genuine newer proof root through Hermes. Expedited destination governance recovers the expired and frozen clients. This uses the ordinary IBC recovery gate which requires a newer substitute proof height. Packet delivery and a valid timeout resume after the response window.

Finally maintenance is deliberately stopped. Hermes and the destination must agree on actual checkpoint expiry. Compact mode stages a verified session before expiry and tries activation afterward. Uploads and completion leave the checkpoint timestamp unchanged. SDK tests cover the exact nanosecond cutoff in both storage modes. Native checks use the first observed committed block at or beyond that cutoff.

The output directory retains signed transactions and simulation results alongside committed RPC results. It also contains `maintenance-result.json`, `maintenance-progress.json`, `checkpoint-lifecycle.json`, `checkpoint-export.json`, Gateway header request logs and the Hermes worker and watcher logs. Touch `gateway.stop` in that directory to end the opt-in Gateway processes. Each Python driver stops only its own disposable Injective container. `--data-volume auto` keeps the databases in Docker volumes derived from the output path. Their names are saved in `data-volume.txt`. Export/import uses a second volume with the `-imported` suffix. The output directory and those volumes can be retained together for inspection.
