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

The timer includes Hermes startup and source batch building, signing and inclusion. Channel creation, fee funding and intent admission happen before it starts. Increasing lane occupancy can change builder costs across runs. Actual block timing and indexer delays can vary. Report the individual runs and compare nearby pairs. These runs do not measure delivery on the counterparty, acknowledgements or sustained traffic after a lane fills.

Keep the host awake during the comparison. The driver records both wall and monotonic elapsed time and stops if they differ by more than five seconds or two percent, whichever is larger. This prevents host suspension from silently distorting a run.

## Relayer funding baseline

Issue #735 needs separate measurements of fees, recipient funding and capital held in protocol outputs. Build the blueprint with Aiken v1.1.24 and run with Deno 2.9.6.

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
cd ../offchain
deno task benchmark:relayer-costs /tmp/relayer-costs.json
```

The harness signs and submits transactions to the compiled-validator emulator with Scalus evaluation. It uses the shared packet builders. It covers ADA and native-asset sends, acknowledgements, error refunds, timeouts, ADA returns and first-seen and existing voucher receipts. The ADA send/acknowledgement and existing-voucher cases each run 32 operations on the same 16 lanes. Recurring profiles use operations 17 through 32. The first operation is reported separately. The ready-acknowledgement-pair case also runs 32 transfers and reports warmed per-transfer means. Other transfer scenarios are single cold examples.

Every transaction must reconcile its resolved input ADA against outputs and its fee. Named wallet balances are independently checked after submission. The evidence retains signed CBOR, reference-script bytes, transaction sizes, execution units, output minimum ADA and resolved inputs. Recreated outputs contribute only their net reserve change. Successful-transaction collateral and collateral return do not enter expense totals. Prepared and reconciled records are retained in the companion `.transactions.jsonl` file even if a later scenario fails. Existing result paths are never overwritten.

These are laboratory ledger costs under the retained mainnet parameter snapshot from September 9, 2026. Counterparty checkpoints and initial deployment are fixture pre-state. Lane initialization is measured separately. Reference publication, client/channel creation, counterparty gas, hosting and operator time are excluded. Complete client updates are measured separately below. The harness calls shared builders directly and does not exercise Gateway or Hermes funding-policy limits.

The output ownership model is:

| Output | Funder in these cases | Spending authority and recovery recipient | Recovery condition |
| --- | --- | --- | --- |
| Funded intent and native escrow principal | Sender | Packet validators enforce delivery or refund of user principal | Successful return, error acknowledgement or proven timeout |
| Liquidity deposit reserve | Sender | Owner recorded in the deposit | Full release or permitted deposit retirement |
| Recipient voucher output | Relayer | Recipient payment key | Recipient can spend the ADA accompanying the voucher |
| CIP-68 metadata | Relayer for a new trace | Metadata validator pays `HostStateDatum.deployer` | Authorized shutdown after voucher dependencies are drained |
| Packet lanes and registry state | Setup sponsor or transaction balancing wallet | Protocol validators control transitions and destinations | No refund entitlement for the original relayer is assumed |

Metadata ADA has a conditional shutdown recovery path. It is not automatically reimbursable to the relayer. Liquidity reserve refunds belong to the recorded deposit owner. See `cardano/onchain/validators/voucher_metadata.ak`, `cardano/onchain/lib/ibc/utils/shutdown.ak` and `refundReserve` in `packages/cardano-ibc-tx-builder-runtime/src/packetLaneTransactions.ts`. User transfer principal is excluded from relayer expense. Recipient top-ups are a relayer cash expense in these fixtures. Protocol-held reserve flows can also include sender funding and must not all be charged to the relayer.

The default workload is **200 transfers daily, 100 in each direction**. It assumes an existing deployment, 100 outbound ADA transfers with acknowledgements and 100 inbound voucher transfers including one new trace. It projects 30 days with no compensation and a 10 ADA spendable reserve. The conservative collateral estimate reserves an observed collateral input for each of four concurrent transactions. That is a wallet-policy assumption and reserved capital rather than an expense.

Pass a workload JSON file as the second argument. Amounts are integer lovelace strings. `upfrontLovelace` records a relayer-funded setup contribution. Zero means deployment has already been funded. Reimbursements are assumed external arrangements. The code does not create a payment mechanism.

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

`relayer-cost-baseline.json` contains the current summary, previous measurements and evidence hashes. Recurring components round up independently to whole lovelace. Their rounded sums can differ slightly from averaged wallet debit. USD is rounded after conversion. A 30-day linear projection is not a 30-day traffic qualification.

### Current-main results

This refresh uses main `11d5ac78` and benchmark commit `694eb6c8`. It includes the earlier reference selection, update coordination, unchanged-set fast path, 24-validator batches, ready acknowledgement pairs, sufficient quorum selection and finalization/forwarding optimizations. It also includes permanent receipt history and the incremental versioned Gateway tree from [#974](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/974). The obsolete ICS-20 pruning and inline builder removals in [#975](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/975) and [#976](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/976) are included.

The pinned Aiken build has blueprint SHA-256 `aaddb51cefff5e8c7def0517764ae707c4a4eb29fd27cbcb0b3df6647e415572`. The run reconciles **223 packet/setup transactions and 44 client-update transactions**, 267 signed transactions in total. The fee parameters remain fixed to isolate code changes. The incremental tree and historical-cache improvements are present in the source revision. These direct builder measurements do not assign them an unmeasured latency or hosting saving.

The [Coinbase ADA spot API](https://api.coinbase.com/v2/prices/ADA-USD/spot) returned **$0.19265 per ADA** at **Sat, 31 Oct 2026 23:57:21 GMT**. The [INJ quote](https://api.coinbase.com/v2/prices/INJ-USD/spot) was **$7.2135** in the same capture. Raw responses and timestamps are retained. Previous and current costs use these same quotes.

| Operation | Previous wallet debit in ADA | Current fees in ADA | Current wallet debit in ADA | Current wallet debit in USD |
| --- | ---: | ---: | ---: | ---: |
| ADA send plus single acknowledgement | 3.871289 | 3.791157 | 3.794121 | $0.73 |
| Existing voucher receipt | 4.170619 | 2.658512 | 3.953937 | $0.76 |
| First-seen voucher receipt | 7.657130 | 3.016592 | 7.438652 | $1.43 |
| ADA send plus acknowledgement in a ready pair, per transfer | 3.168376 | 3.108328 | 3.111291 | $0.60 |

Previous means are from the published October 30 report at main `d3b3810e`. Current packet-only wallet depletion is **778.29 ADA ($149.94) per day**. The 30-day packet funding is **23,348.72 ADA ($4,498.13)**. The packet collateral assumption separately reserves 1,200.00 ADA. Including a 10 ADA spendable reserve gives 24,558.72 ADA of peak packet funding. Client updates are added below.

All 16 of 16 ready acknowledgement pairs met the 20 percent execution and size margins. The fixture keeps sends single and pairs already-ready acknowledgements at a common proof height on distinct lanes. It does not establish a production pairing rate. Singleton work dispatches immediately and there is no collection timer. Isolated outbound fixtures can return their commitment tree to empty. Mixed-direction lanes retain receipt history. These short profiles do not establish production costs at every historical tree shape.

#### Complete Tendermint updates

```sh
python3 scripts/benchmark/tendermint-costs.py /tmp/tendermint-costs --deno deno
```

Each row is one complete cold update using the same captured 45-validator Injective header. All 45 validator entries authenticate the set. The fixture selects 17 of 43 available signatures. General controls also select six trusted-set membership proofs. These are fixture outcomes rather than production constants. An unchanged set lets the verifier reuse the authenticated trusted next-validator hash. The general control forces trusted-set reconstruction. It does not reproduce actual validator churn.

The driver retains source hashes, signed CBOR, reference bytes and independent wallet checks. Client creation, stake registration and reference publication precede measurement. A fixed public test mnemonic makes wallet selection repeatable. The fixture's injected 30 ADA client reference is recorded separately and excluded from relayer income. Finalization updates client and HostState roots, archives the checkpoint and burns the session token.

| Complete update | Previous fees in ADA | Current fees in ADA | Transactions | Current USD |
| --- | ---: | ---: | ---: | ---: |
| Unchanged set, batches of 24 | 4.811116 | 4.811116 | 4 | $0.93 |
| General control, trusted batches of 24 and membership batches of six | 9.150311 | 9.150311 | 12 | $1.76 |
| Unchanged set, batches of six | 7.397605 | 7.397605 | 10 | $1.43 |
| General control, batches of six | 11.735157 | 11.735157 | 18 | $2.26 |

All four complete client controls reproduce the preceding report's fees exactly. The recent receipt-history and cleanup changes do not reduce client-update fees. The unchanged-set path still takes four transactions and the general control takes twelve. No unmerged wider-batch redesign or exploratory removal of security checks is included.

| Fee component in ADA per complete update | Unchanged set, batches of 24 | General-path control |
| --- | ---: | ---: |
| Fixed and signed-transaction-size fees | 1.449164 | 3.459176 |
| Execution fees | 2.062368 | 3.008103 |
| Reference-script fees | 1.298880 | 2.680920 |
| Builder margin | 0.000704 | 0.002112 |
| Total | 4.811116 | 9.150311 |

Reference charges use resolved script bytes and the ledger's [tiered reference-script rule](https://developers.cardano.org/docs/learn/core-concepts/fees/). Ordinary finalization references **50,730 bytes** and costs **2.176019 ADA**, including **0.836340 ADA** in reference-script fees. The unchanged-set session temporarily holds 5.115970 ADA and releases it at finalization. Net protocol reserve growth is zero in this prefunded fixture.

The [retained forwarding setup comparison](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/972#issuecomment-6532325557) adds 0.379033 ADA in fees and 23.463800 ADA of refundable staking and reference-output reserves when references are published separately. The daily examples assume an already-funded deployment built from current main.

#### Daily Cardano funding

Singleton examples assume 100 receive proof heights and 100 acknowledgement proof heights daily. Ready pairs assume 100 receive heights and 50 acknowledgement heights. There are no additional idle refresh updates. Production proof-height reuse and validator-set change rates remain inputs. No separate monetary saving is assigned to worker coordination.

| Cardano funding for 200 transfers daily | ADA per day | USD per day | USD over 30 days |
| --- | ---: | ---: | ---: |
| Single packets and 200 unchanged-set updates | 1,740.51 | $335.31 | $10,059.30 |
| 50 already-ready acknowledgement pairs and 150 unchanged-set updates | 1,431.67 | $275.81 | $8,274.37 |
| Single packets and 200 general-path control updates | 2,608.35 | $502.50 | $15,074.97 |

The 200 unchanged-set client updates alone cost **962.22 ADA per day**. These scenarios include current packet costs and client fees. Dedicated collateral and temporary session reserves are additional capital. The client fixture selects up to 964.52 ADA of collateral input value while declaring only 5 ADA per transaction. The selected input returns on success. The JSON records conservative four-worker peaks. A smaller dedicated-collateral wallet policy has not been qualified.

#### ICS-20 receipt pruning is removed

Permanent receipt and acknowledgement commitments remain authenticated in the lane's Merkle root. They no longer fill bounded datum lists. Current ICS-20 transfer processing requires **zero pruning transactions and zero pruning proof updates**. The obsolete lane-prune builder and validator have been deleted. Remaining inline interchain-query cleanup belongs to the separate query feature and is outside this ICS-20 workload.

The preceding report measured 1.809451 ADA for one prune and modelled 100 prunes daily. One scenario reused packet proof heights. The other required 100 extra client updates. Comparing those previous models with the current singleton unchanged-set case gives:

| Previous cleanup assumption for the same 200 transfers | Previous ADA/day | Current ADA/day | Saving USD/day | Saving USD/30 days |
| --- | ---: | ---: | ---: | ---: |
| Previous prunes reused packet proof heights | 1,950.85 | 1,740.51 | $40.52 | $1,215.61 |
| Previous prunes needed 100 extra client updates | 2,431.96 | 1,740.51 | $133.21 | $3,996.20 |

These comparisons include both the measured packet-cost change and removed cleanup. They are conditional linear projections rather than sustained production runs. Canonical receipt history must remain available. Gateway's incremental SQLite trees are rebuildable caches. The benchmark does not price retained history storage or recovery.

#### Retained Injective evidence

The October 30 native replay and October 29 live Hermes observations keep their original dates. All 126 recorded Go runtime source hashes match current main. No Go light-client source changes or new release are required by this refresh. No new native replay or public-testnet transfer is claimed.

| Available bodies and retained measurement | One-body complete update fee in INJ | Adaptive complete update fee in INJ | Fee reduction |
| --- | ---: | ---: | ---: |
| 1 body, live Hermes median | 0.0103862800 | 0.0103723015 | 0.1% |
| 4 bodies, live Hermes median | 0.0122104730 | 0.0113448160 | 7.1% |
| 64 bodies, native replay | 0.071107745 | 0.059337156 | 16.55% |

The live samples use 13-pool signed fixtures and 24 confirmation headers with five fresh-state samples per mode and body count. The native replay uses retained canonical history from a five-pool local Cardano ledger with one transaction-bearing block and a controlled clock. It reduces body submissions from 64 to 16 and total transactions from 75 to 27. Both wallets reconcile and reach the same verified checkpoint. The retained gas price is 500000000 INJ base units per gas with a 1.8 multiplier. The 75% body-transaction reduction is not a 75% fee saving. Four bodies is a ceiling and no wait is introduced to form a batch. A daily INJ budget still needs observed update frequency, backlog, stake-table changes and source activity.

The packet report, journal and client artifact contain the new signed measurements. Previous packet/client evidence files are replaced rather than duplicated. Counterparty evidence updates source-identity verification while retaining the original observations. The October 28 idle resource sample remains historical. Evidence paths and uncompressed SHA-256 hashes are in `relayer-cost-baseline.json`.

```sh
gzip -dc scripts/benchmark/evidence/relayer-costs-2026-11-01.json.gz \
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

Use a dedicated deployment before qualifying production costs. Pin the code and relayer revisions, images, protocol parameters, retained-history policy, workload and host limits. Run warm-up separately from equivalent early and late traffic windows. Record transaction-linked wallet flows and every top-up or reimbursement. Run an uninterrupted 72-hour baseline before the seven-day qualification described in #735. Fault injection needs a separate marked phase on the disposable deployment. Compare post-idle memory and backlog drainage with the pre-load baseline.

The lab cost report and a short resource collection do not complete #735. The qualification still needs numeric budgets agreed before the run, real two-chain traffic and client maintenance, live wallet reconciliation, database/WAL and retained-history measurements, fault recovery and infrastructure pricing. Local devnet memory and storage cannot establish the cost of a fully synced production node. Quote hosting and RPC costs for the selected architecture separately. Keep those prices and dates with the results. Do not present the transaction-only funding projection as a complete monthly operating cost.
