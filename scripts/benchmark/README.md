This benchmark runs the actual Hermes funded executor against an already deployed disposable Cardano devnet with open transfer channels. It uses the production Gateway, Hermes signing policy and trusted Ogmios evaluation and submission. Every run starts with a newly funded backlog and ends after Hermes records all send inclusions. Before timing it authenticates the admission transaction after 24 descendant blocks. After timing it also waits for 24 descendant blocks and authenticates the send transaction bodies from canonical blocks and checks that each admitted output appears exactly once among their inputs. It also checks that Kupo reports every admitted output as spent.

Use a dedicated magic-42 runtime inside `.deployment-smoke`. Retain its `compose.json`, `runtime/genesis-shelley.json`, `handler.json`, pinned `hermes.toml` and public fixture key store. The Gateway must use this deployment and all endpoints must refer to this runtime. `benchmark-ports.json` supplies `DEVKIT_OGMIOS_PORT` and `DEVKIT_KUPO_PORT`. Canonical transaction checks also use its `DEVKIT_HISTORY_DB_PORT` and `DEVKIT_HISTORY_PORT`. These history endpoints must be published by the selected Compose project. `benchmark-offset.json` supplies the historical disposable clock offset as `{"offset": -123456}`. Keep `FAKETIME_DONT_FAKE_MONOTONIC=1` for Hermes so durations use real elapsed time.

Split the signer fee inputs and fund the published test user once:

```sh
deno run -A --config cardano/offchain/deno.json \
  scripts/benchmark/prepare-packet-executor-backlog.ts \
  "$RUNTIME" wallets
```

Initialize the lanes outside the timed comparison:

```sh
python3 scripts/benchmark/packet-executor.py \
  --runtime "$RUNTIME" --hermes "$HERMES_BINARY" \
  --channels channel-0 channel-1 channel-2 channel-3 \
  --per-channel 1 --warmup
```

Lane initialization must fund all of the new state outputs. If the pinned signer top-up allowance is too small, explicitly supply `--warmup-top-up-lovelace` with the required setup budget. This option is allowed only for warmup. Timed send runs retain the allowance from the pinned config.

Compare a 16-intent backlog at widths one, two and four in opposite orders:

```sh
python3 scripts/benchmark/packet-executor.py \
  --runtime "$RUNTIME" --hermes "$HERMES_BINARY" \
  --channels channel-0 channel-1 channel-2 channel-3 \
  --per-channel 4 --widths 1 2 4 4 2 1
```

Receipts, complete Hermes logs, configs and `report.json` remain in a new directory inside the runtime. Stop any other relayer for this deployment before each run. The driver stops only its own Hermes process. A failed admission or drain retains evidence and stops the comparison. Reconcile retained transactions before retrying. The fee funding helper refuses to overwrite its receipt.

The timer includes Hermes startup and source batch building, signing and inclusion. Channel creation, fee funding and intent admission happen before it starts. Increasing lane occupancy can change builder costs across runs. Actual block timing and indexer delays can vary. Report the individual runs and compare nearby pairs. These runs do not measure delivery on the counterparty, acknowledgements, pruning or sustained traffic after a lane fills.

Keep the host awake during the comparison. The driver records both wall and monotonic elapsed time and stops if they differ by more than five seconds or two percent, whichever is larger. This prevents host suspension from silently distorting a run.

The [retained comparison results](results/2026-10-08-packet-executor.json) from 2026-10-08 used Hermes `1.13.2+9c3035d5` on a dedicated VM with four CPUs and 4 GiB of memory. Each run drained 16 intents across four channels. The run order was `1 2 4 4 2 1`. Width one took 30.19 and 40.60 seconds. Width two took 49.39 and 28.88 seconds. Width four took 16.70 and 29.39 seconds. Their median times were 35.40, 39.14 and 23.05 seconds. Width four's median drain rate was about 1.54 times the serial rate. Width two did not improve the median. Two runs per width do not establish a stable throughput rate.

All six runs used eight two-intent transactions with no initialization transactions or executor retries. Canonical checks authenticated every admission and send after at least 24 descendant blocks. Every admitted output had exactly one authenticated spend. Width four reached four concurrent channel batches and four send transactions in one block. The two-intent builder bound remains unchanged. Pruning is still managed by the operator and its cost is outside this finite comparison.

A host interruption stopped an earlier comparison after two verified runs. Those samples are retained separately and are excluded from these medians. The admitted but unexecuted backlog was cancelled and canonically checked. The disposable source clock was recovered before the complete comparison. Recovery was outside every timer. Protocol limits and chain state were preserved.

The single-channel control drained four intents in 10.07 seconds at width one and 11.67 seconds at width four. Both used two two-intent transactions with zero retries and only one channel batch in flight. The same canonical checks passed. Raising the setting did not introduce concurrency within that channel.
