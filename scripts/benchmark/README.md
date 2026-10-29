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

## Relayer funding baseline

Issue #735 needs separate measurements of fees, recipient funding and capital held in protocol outputs. Run the cost benchmark with Aiken v1.1.24 and the Deno version pinned by CI. Build the blueprint first.

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
cd ../offchain
deno task benchmark:relayer-costs /tmp/relayer-costs.json
```

This signs and submits transactions to the compiled-validator emulator with Scalus evaluation. It uses the shared packet builders. It covers ADA and native-asset sends, acknowledgements, error refunds, timeouts, ADA returns, and first-seen and existing voucher receipts. The ADA send/acknowledgement and existing-voucher cases each run 32 operations on the same 16 lanes. Recurring profiles use operations 17 through 32. The first operation is reported separately. The other scenarios are single-operation examples. No pruning is performed.

These are ledger cost measurements under the retained mainnet parameter snapshot from September 9, 2026. They are not current-mainnet price quotes or live-chain transaction evidence. The report includes the effective parameters, blueprint hash, repository commit, signed CBOR, transaction sizes, execution units and resolved inputs. Counterparty checkpoints and initial deployment are fixture pre-state. Channel-lane initialization is measured separately. Reference publication, client and channel creation, client updates, counterparty gas, hosting and operator time are excluded. The benchmark calls the builders directly and does not exercise Gateway or Hermes funding-policy limits.

Every successful transaction must reconcile its resolved input ADA against outputs and its fee. Each output records its actual ADA and ledger minimum. Wallet balances are independently checked after submission. Payment credentials identify wallets so a refund to an enterprise address is still attributed to the same owner. Recreated UTxOs contribute only their net change in capital. Successful-transaction collateral and collateral return do not enter expense totals. Both selected collateral inputs and declared collateral are recorded. The companion `.transactions.jsonl` file retains prepared and reconciled records even if a later scenario fails. Existing result paths are never overwritten.

The output ownership model is:

| Output | Funder in these cases | Spending authority and recovery recipient | Recovery condition |
| --- | --- | --- | --- |
| Funded intent and native escrow principal | Sender | Packet validators enforce delivery or refund of user principal | Successful return, error acknowledgement or proven timeout as applicable |
| Liquidity deposit reserve | Sender | The owner recorded in the deposit receives the reserve | Full release or permitted retirement of the deposit |
| Recipient voucher output | Relayer | Recipient payment key | Recipient can spend the ADA accompanying the voucher |
| CIP-68 metadata | Relayer for a new trace | Metadata validator sends reclaimed value to `HostStateDatum.deployer` | Authorized shutdown after voucher dependencies are drained |
| Packet lanes and registry state | Setup sponsor or transaction balancing wallet | Protocol validators control transitions and authorized destinations | No refund entitlement for the original relayer is assumed |

The current metadata validator has a shutdown reclamation path. It is no longer the always-failing validator described in the original issue. Metadata ADA is therefore protocol-held capital with a conditional recovery path. It is not automatically reimbursable to the relayer. Liquidity reserve refunds go to the deposit owner. Receiving a refund does not establish that the relayer recovered its costs. See `cardano/onchain/validators/voucher_metadata.ak`, `cardano/onchain/lib/ibc/utils/shutdown.ak` and `refundReserve` in `packages/cardano-ibc-tx-builder-runtime/src/packetLaneTransactions.ts`.

The default projection assumes an existing deployment and 100 outbound ADA transfers with acknowledgements plus 100 inbound voucher transfers per day. One inbound transfer introduces a new trace. It projects 30 days with no compensation. It keeps a 10 ADA spendable reserve. Its collateral estimate conservatively reserves a separate observed collateral input for each of four concurrent transactions. This is an explicit wallet-policy assumption rather than a collateral expense or a claim that the ledger requires separate collateral inputs.

Pass a workload JSON file as the second argument to change the assumptions. Amounts are integer lovelace strings. `upfrontLovelace` is an explicit relayer-funded setup contribution. Its default of zero means someone else has already funded deployment. A reimbursement is an assumed external arrangement. The code does not create a fee mechanism or a refund entitlement.

```json
{
  "executionsPerDay": {
    "outbound-ada-ack": 100,
    "receive-existing-voucher": 99,
    "receive-new-voucher": 1
  },
  "days": 30,
  "concurrency": 4,
  "spendableReserveLovelace": "10000000",
  "upfrontLovelace": "0",
  "reimbursementPerDayLovelace": "0",
  "reimbursementDelayDays": 0
}
```

The model reports wallet depletion separately from fees, recipient top-ups and protocol reserve changes. Protocol-held ADA includes sender-owned reserves and must not all be attributed to the relayer. Recipient top-ups and unreimbursed protocol contributions need an explicit funding policy. Options include sender-funded requests, recipient funding, a protocol sponsor or a separately agreed relayer payment. Any payment must be explicit and preserve user transfer principal. A script's ability to reclaim funds at shutdown is not a funding policy.

`relayer-cost-baseline.json` retains the current summary and hashes of its evidence. It also records the previous baseline for comparison. Recurring components round up independently to whole lovelace. Their rounded sums can differ slightly from the rounded wallet debit. Reconciliation is checked per transaction before averaging. The 30-day projection is a linear funding scenario. Running that workload for 30 days still requires capacity and pruning qualification.

### Recorded results

The October 29, 2026 rerun uses main commit `7ea37e4d` with the reference-script selection from #953 and Hermes packing from #955. It reconciled 143 measured Cardano transactions. The Aiken version, blueprint hash, fee parameters and workload match the October 28 baseline. The send/acknowledgement and existing-voucher figures are warmed means. The first-seen voucher figure is a single observation. Generated fixture wallets can cause small variations between runs. The Cardano fees still use the September 9, 2026 parameter snapshot.

The [Coinbase spot API](https://api.coinbase.com/v2/prices/ADA-USD/spot) returned **0.20543 USD per ADA** at **2026-10-29 15:49:33 UTC**. Both Cardano baselines use this same quote below so exchange-rate movement does not enter the reported saving. The original quote and the complete new response are recorded in `relayer-cost-baseline.json`.

| Operation | Previous wallet debit in ADA | Current fees in ADA | Current wallet debit in ADA | Current wallet debit in USD |
| --- | ---: | ---: | ---: | ---: |
| ADA send plus acknowledgement | 4.76 | 3.91 | 3.91 | $0.80 |
| Existing voucher receipt | 4.38 | 2.70 | 4.16 | $0.85 |
| First-seen voucher receipt | 7.87 | 3.06 | 7.64 | $1.57 |

At 100 outbound ADA transfers and 100 inbound voucher transfers per day, including one new trace, projected wallet depletion falls from **916.90 to 810.41 ADA per day**, an **11.6% reduction**. At the common quote that is **$188.36 to $166.48 per day**, saving **$21.88 per day or $656.27 over 30 days**. Cardano fees fall by 13.9%. The entire wallet saving comes from lower fees. Recipient funding and protocol reserve flows are unchanged. One-time 16-lane initialization fees also fall from 1.994221 to 1.488223 ADA and are outside this already-funded-deployment projection.

The 30-day Cardano funding scenario now consumes **24,312.33 ADA ($4,994.48)**. The conservative collateral reserve remains **1,200 ADA ($246.52)**. Collateral is available capital rather than a consumed expense. Including the 10 ADA spendable reserve brings projected peak funding to **25,522.33 ADA ($5,243.05)**. These figures include recipient top-ups and relayer contributions to protocol outputs. They exclude hosting, client maintenance, counterparty fees and pruning. They still require live-chain, capacity and pruning qualification.

Injective comparisons are recorded separately. The first two rows below come from the retained October 29 live Hermes runs. They use 13-pool signed source fixtures and 24 confirmation headers with five fresh-state observations per mode. The last row is a fresh cold replay of 64 full bodies and 32 headers from a five-pool local ledger with one transaction-bearing block. It submits through the native Injective application's socket ABCI interface with a controlled clock. Each row compares the same evidence under both packing modes. The runtime Go sources match the existing native build. No light-client module change is involved.

| Available bodies and measurement | Previous complete update fee in INJ | Packed complete update fee in INJ | Fee reduction |
| --- | ---: | ---: | ---: |
| 1 body, live Hermes median | 0.0103862800 | 0.0103723015 | 0.1% |
| 4 bodies, live Hermes median | 0.0122104730 | 0.0113448160 | 7.1% |
| 64 bodies, native replay | 0.0711049890 | 0.0593359560 | 16.55% |

All observations use 500000000 INJ base units per gas and a 1.8 gas multiplier. The live figures exclude the separate packet receipt transaction. The cold replay reconciles both wallets against charged fees and produces the same final checkpoint in both modes. The [recorded INJ quote](https://api.coinbase.com/v2/prices/INJ-USD/spot) was $8.0855 at the same observation time. Four bodies is a limit rather than a batching target. Hermes packs bodies already available and does not hold updates to accumulate more. The report assumes neither a 75% fee reduction nor four bodies in every production update. A daily INJ budget needs observed update frequency, backlog sizes, stake-table changes and representative source activity. These sample costs are not added to the Cardano funding projection.

The full report, transaction journal, counterparty comparisons and historical short resource-collector check are committed as gzip files in `evidence/`, about 0.6 MB combined. The previous full Cardano report and journal have been replaced by the current run. `artifactFiles` identifies each file and `artifactSha256` records hashes of their uncompressed contents. The counterparty artifact includes the native replay inputs and results, all twenty live fee observations and four representative signed transaction sets. The remaining live transaction data is retained locally. For example, extract the full Cardano transaction report with:

```sh
gzip -dc scripts/benchmark/evidence/relayer-costs-2026-10-29.json.gz \
  > /tmp/relayer-costs-recorded.json
```

## Resource collection and qualification

The resource sampler only observes the selected Compose projects and optional host PIDs. It records image IDs, configured CPU/RAM limits, Docker VM capacity, timestamped memory and CPU, network and block-I/O counters, and host-process RSS when requested. It writes JSONL incrementally and ends with a completion record. Keep incomplete files after a service disappearance or host suspension. They are evidence of an interrupted window.

```sh
python3 scripts/benchmark/relayer-resources.py \
  --project YOUR_DISPOSABLE_PROJECT \
  --pid YOUR_HERMES_PID \
  --phase traffic --duration 3600 --interval 10 \
  --output /tmp/relayer-traffic.jsonl
```

Use a dedicated deployment before qualifying production costs. Pin the code and relayer revisions, images, protocol parameters, pruning settings, workload and host limits. Run warm-up separately from equivalent early and late traffic windows. Record transaction-linked wallet flows and every top-up or reimbursement. Run an uninterrupted 72-hour baseline before the seven-day qualification described in #735. Fault injection needs a separate marked phase on the disposable deployment. Compare post-idle memory and backlog drainage with the pre-load baseline.

The lab cost report and a short resource collection do not complete #735. The qualification still needs numeric budgets agreed before the run, real two-chain traffic and client maintenance, live wallet reconciliation, database/WAL and retained-state measurements, pruning, fault recovery and infrastructure pricing. Local devnet memory and storage cannot establish the cost of a fully synced production node. Quote hosting and RPC costs for the selected architecture separately. Keep those prices and dates with the results. Do not present the transaction-only funding projection as a complete monthly operating cost.
