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

This signs and submits transactions to the compiled-validator emulator with Scalus evaluation. It uses the shared packet builders. It covers ADA and native-asset sends, acknowledgements, error refunds, timeouts, ADA returns, and first-seen and existing voucher receipts. The ADA send/acknowledgement and existing-voucher cases each run 32 operations on the same 16 lanes. Recurring profiles use operations 17 through 32. The first operation is reported separately. The ready-acknowledgement-pair case also runs 32 transfers and reports warmed per-transfer means. Other scenarios are single-operation examples. No pruning is performed.

These are ledger cost measurements under the retained mainnet parameter snapshot from September 9, 2026. They are not current-mainnet price quotes or live-chain transaction evidence. The report includes the effective parameters, blueprint hash, repository commit, signed CBOR, transaction sizes, execution units and resolved inputs. Counterparty checkpoints and initial deployment are fixture pre-state. Channel-lane initialization is measured separately. The packet harness excludes reference publication, client and channel creation, client updates, counterparty gas, hosting and operator time. The companion client benchmark below adds complete update measurements. The benchmark calls the builders directly and does not exercise Gateway or Hermes funding-policy limits.

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

The October 30 rerun is rebased on main `45f7075f` with Hermes `6a1ee216`. It includes reference selection, adaptive body packing, session reserve preservation, verification that reuses an unchanged validator set, larger verification batches, concurrent update coordination and ready acknowledgement pairs. It reconciles **223 packet-lifecycle transactions and 44 complete client-update transactions**. These are signed compiled-validator emulator transactions. Counterparty checkpoints and deployment are fixture pre-state. The fee parameters remain the September 9, 2026 snapshot so the code comparison is controlled. They are not a fresh mainnet fee attestation.

The [Coinbase ADA spot API](https://api.coinbase.com/v2/prices/ADA-USD/spot) returned **$0.19082 per ADA** at **2026-10-30 13:43:53 UTC**. The [INJ quote](https://api.coinbase.com/v2/prices/INJ-USD/spot) was **$7.0645** in the same capture. Full responses and HTTP dates are retained in `relayer-cost-baseline.json`. Both old and new costs use these same quotes below. Exchange-rate movement is separate from protocol savings.

| Operation | Previous wallet debit in ADA | Current fees in ADA | Current wallet debit in ADA | Current wallet debit in USD |
| --- | ---: | ---: | ---: | ---: |
| ADA send plus single acknowledgement | 3.910377 | 3.868339 | 3.871302 | $0.74 |
| Existing voucher receipt | 4.158880 | 2.713946 | 4.170457 | $0.80 |
| First-seen voucher receipt | 7.644173 | 3.072331 | 7.658171 | $1.46 |
| ADA send plus acknowledgement in a ready pair, per transfer | Not measured | 3.165405 | 3.168368 | $0.60 |

The single-send/acknowledgement and existing-voucher figures are means of operations 17 through 32 on the same 16 lanes. The first-seen voucher figure is one cold operation. Some individual paths are slightly more expensive after the shared contract changes. For the unchanged default workload of **100 outbound transfers and 100 inbound transfers per day**, including one new trace, **packet-only wallet depletion falls from 810.41 to 807.66 ADA per day**, a **0.34% reduction**. At the common quote that is **$154.64 to $154.12 per day**. The saving is **$0.52 per day or $15.73 over 30 days**. Recipient funding and gross protocol reserve flows are unchanged. Lower dollar amounts than the previous report also reflect a different ADA price.

This packet-only scenario consumes **24,229.91 ADA ($4623.55) over 30 days**. Its existing wallet-shape assumption reserves another **1,200.00 ADA** as collateral. With 10 ADA of spendable reserve its peak funding is **25,439.91 ADA ($4854.44)**. Collateral is capital, not a successful-transaction expense. These figures still exclude client maintenance, Injective daily fees, hosting and pruning.

The ready-pair fixture keeps sends single so it isolates acknowledgement aggregation within the lifecycle. Both successful acknowledgements are available at one proof height and update different lanes. It runs 32 transfers as 16 pairs. All 16 candidates fit the Gateway's 20 percent execution and size margin. The observed peak is 13,050,834 memory units against a 16,500,000 limit. The warmed per-transfer wallet debit falls from 3.871302 to 3.168368 ADA, about 18.2%. This does not establish a production pairing rate. The runtime submits a singleton immediately and falls back when a candidate exceeds its margins. It adds no collection timer.

#### Complete Tendermint updates

The previous report excluded these updates. They are now measured separately with the existing signed consensus-history fixture and a captured 45-validator Injective header. The general controls deliberately use the supported trusted-set reconstruction path for that same unchanged header. They are controls for the extra work, not measurements of validator-set churn. The final transaction really updates the client and host roots, archives the old checkpoint and burns the session token. Every transaction and relayer wallet balance reconciles.

```sh
python3 scripts/benchmark/tendermint-costs.py /tmp/tendermint-costs --deno deno
```

The command retains its derived runner, source hashes, full signed CBOR and measurements. It changes the fixture's header and batch choice while retaining its validation assertions. The fixture injects a prefunded 30 ADA client reference during finalization. That setup credit is independently identified in the ledger and excluded from measured income. Client creation, stake registration and reference publication precede the measured lifecycle or are fixture pre-state.

| Complete update | Transactions | Fees and net wallet debit in ADA | USD |
| --- | ---: | ---: | ---: |
| General control, batches of six | 18 | 17.046098 | $3.25 |
| Unchanged set, batches of six | 10 | 10.072004 | $1.92 |
| Unchanged set, batches of 24 | 4 | 6.536141 | $1.25 |
| General control, trusted batches of 24 and membership batches of six | 12 | 13.511309 | $2.58 |

Comparing the general control with batches of six to the unchanged-set case with batches of 24 reduces fees by **61.7%** and sequential transactions from 18 to four. The general path keeps signature membership batches at six while allowing 24 trusted validators per batch. The unchanged path checks signatures, quorum and time without reconstructing the authenticated set again. No waiting window is needed because the validators and signatures are already available. Emulator elapsed times are retained as diagnostics, not ICS-20 delivery or network inclusion times.

The session with batches of 24 temporarily holds up to **5.115970 ADA** and releases it at finalization. Net protocol reserve growth is zero in this prefunded fixture. This is neither a fee nor a new expense on every continuation. The existing client and host outputs still require funded capital. Long-term history growth and pruning remain separate qualification work.

#### Daily funding including client maintenance

Update frequency is an explicit input. A proof at a height that is already retained can reuse it. A new required height triggers an update immediately. Concurrent coordination shares accepted or in-flight work but this benchmark does not establish a paid-duplicate rate or worker resource saving. No extra monetary saving is credited to coordination.

For the same 200-transfer workload, the following examples assume no extra idle refresh updates. The single-packet cases assume 100 distinct receive proof heights and 100 distinct acknowledgement proof heights. The ready-pair case assumes 100 receive heights and 50 acknowledgement heights. Neither proof-height reuse nor the proportion of unchanged sets is inferred from the fixture. These are scenarios, not production forecasts.

| Cardano funding scenario | ADA per day | USD per day | USD over 30 days |
| --- | ---: | ---: | ---: |
| Single packets and 200 unchanged-set updates | 2,114.89 | $403.56 | $12106.91 |
| 100 outbound packets acknowledged in 50 ready pairs, plus 150 unchanged-set updates | 1,717.79 | $327.79 | $9833.67 |
| Single packets and 200 general-path control updates | 3,509.93 | $669.76 | $20092.92 |

For example, 200 unchanged-set updates add **1,307.23 ADA per day** to the packet-only figure. The resulting 2,114.89 ADA total has a broader scope than the old 810.41 ADA packet-only quote. The ready-pair row assumes a different traffic opportunity. Its lower proof-height count must not be credited again as an independent coordination saving.

The client fixture selects an approximately 967 ADA collateral input while declaring 5 ADA per transaction. That large input is reserved and returns on success. It is a wallet-shape artifact, not a protocol minimum or an expense. The JSON records the conservative peak for four such inputs plus temporary session reserves. Four dedicated 5 ADA inputs would cover the observed declared collateral with 20 ADA, but this benchmark does not qualify that wallet-selection policy. Neither estimate is a production hosting or wallet-sizing recommendation.

#### Injective comparisons

The October 30 native replay resubmits the same 64 full bodies and 32 headers from a five-pool local Cardano ledger, including one transaction-bearing block. It uses the native Injective application interface (ABCI) with a controlled clock. All 126 runtime Go source hashes match current main. No Go module change or new light-client release is involved. The twenty live Hermes observations remain historical October 29 evidence from 13-pool signed fixtures with 24 confirmation headers. They have not been relabelled as fresh public-testnet transfers.

| Available bodies and measurement | One-body complete update fee in INJ | Adaptive complete update fee in INJ | Fee reduction |
| --- | ---: | ---: | ---: |
| 1 body, retained live Hermes median | 0.0103862800 | 0.0103723015 | 0.1% |
| 4 bodies, retained live Hermes median | 0.0122104730 | 0.0113448160 | 7.1% |
| 64 bodies, fresh native replay | 0.071107745 | 0.059337156 | 16.55% |

The replay reduces full-body submissions from 64 to 16 and total transactions from 75 to 27. Both wallets reconcile against charged fees and reach the same verified checkpoint. This is **75% fewer body transactions, not 75% lower fees**. It still uses the retained 500000000 INJ base units per gas and 1.8 gas multiplier. Four bodies is a ceiling, not a target or a collection delay. The earlier transport savings are not credited a second time as a new improvement in this rerun. A daily INJ budget still needs observed update frequency, backlog, stake-table changes and representative source activity, so these sample costs remain outside the daily Cardano totals.

The new full packet report, journal, client-update evidence and Injective replay replace the previous fee artifacts. The historical October 28 idle sample remains explicitly historical. All five gzip files total about 0.9 MB. `artifactFiles` and hashes of their uncompressed contents are in `relayer-cost-baseline.json`. For example:

```sh
gzip -dc scripts/benchmark/evidence/relayer-costs-2026-10-30.json.gz \
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
