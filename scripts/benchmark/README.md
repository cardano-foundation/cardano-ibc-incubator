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

Issue #735 needs separate measurements of fees, recipient funding and capital held in protocol outputs. Run the cost benchmark with Aiken v1.1.24 and the Deno version pinned by CI. Build the blueprint first.

```sh
cd cardano/onchain
aiken build --deny --trace-level silent
cd ../offchain
deno task benchmark:relayer-costs /tmp/relayer-costs.json
```

This signs and submits transactions to the compiled-validator emulator with Scalus evaluation. It uses the shared packet builders. It covers ADA and native-asset sends, acknowledgements, error refunds, timeouts, ADA returns, and first-seen and existing voucher receipts. The ADA send/acknowledgement and existing-voucher cases each run 32 operations on the same 16 lanes. Recurring profiles use operations 17 through 32. The first operation is reported separately. The ready-acknowledgement-pair case also runs 32 transfers and reports warmed per-transfer means. Other transfer scenarios are single-operation examples. A separate single-sequence receipt-pruning sample follows the existing-voucher receives. The default packet-only projection excludes that cleanup. Daily scenarios below add it explicitly.

These are ledger cost measurements under the retained mainnet parameter snapshot from September 9, 2026. They are not current-mainnet price quotes or live-chain transaction evidence. The report includes the effective parameters, blueprint hash, repository commit, signed CBOR, transaction sizes, execution units and resolved inputs. Counterparty checkpoints and initial deployment are fixture pre-state. Channel-lane initialization is measured separately. The packet harness excludes reference publication, client and channel creation, client updates, counterparty gas, hosting and operator time. The companion client benchmark below adds complete update measurements. Receipt cleanup is measured separately from the receive that creates its state. The benchmark calls the builders directly and does not exercise Gateway or Hermes funding-policy limits.

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

Pass a workload JSON file as the second argument to change the assumptions. Adding `"packet-prune": 100` to `executionsPerDay` includes 100 daily receipt prunes. That profile is measured after `receive-existing-voucher` so its prerequisite receive is not charged twice. Amounts are integer lovelace strings. `upfrontLovelace` is an explicit relayer-funded setup contribution. Its default of zero means someone else has already funded deployment. A reimbursement is an assumed external arrangement. The code does not create a fee mechanism or a refund entitlement.

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

`relayer-cost-baseline.json` retains the current summary and hashes of its evidence. It also records the previous baseline for comparison. Recurring components round up independently to whole lovelace. Their rounded sums can differ slightly from the rounded wallet debit. Reconciliation is checked per transaction before averaging. USD totals are rounded after summing unrounded components so displayed amounts can differ by a cent. The 30-day projection is a linear funding scenario. Running that workload for 30 days still requires capacity and pruning qualification.

### Recorded results

The October 30 refresh is rebased on main `d3b3810e` and pins Hermes `a69c903b`. It includes sufficient quorum-witness selection and the finalization and forwarding changes merged after the previous report at main `45f7075f`. The measurements were captured at benchmark commit `ad946748`. The pinned Aiken `v1.1.24` build has blueprint SHA-256 `8cbadb26eeebbc760cc28b34d4af33f7895f9f1576086c51952be575e2e36a61`. The run reconciles **224 packet and pruning transactions plus 44 complete client-update transactions**. These are signed compiled-validator emulator transactions with independent wallet reconciliation. The fee parameters remain the September 9, 2026 snapshot to isolate code changes.

The [Coinbase ADA spot API](https://api.coinbase.com/v2/prices/ADA-USD/spot) returned **$0.19442 per ADA** at **2026-10-30 23:05:53 UTC**. The [INJ quote](https://api.coinbase.com/v2/prices/INJ-USD/spot) was **$7.114** in the same capture. Responses and HTTP dates are retained in `relayer-cost-baseline.json`. Both previous and current token costs use these same quotes below.

| Operation | Previous wallet debit in ADA | Current fees in ADA | Current wallet debit in ADA | Current wallet debit in USD |
| --- | ---: | ---: | ---: | ---: |
| ADA send plus single acknowledgement | 3.871302 | 3.868326 | 3.871289 | $0.75 |
| Existing voucher receipt | 4.170457 | 2.714108 | 4.170619 | $0.81 |
| First-seen voucher receipt | 7.658171 | 3.071290 | 7.657130 | $1.49 |
| ADA send plus acknowledgement in a ready pair, per transfer | 3.168368 | 3.165412 | 3.168376 | $0.62 |

The single-send/acknowledgement and existing-voucher figures are means of operations 17 through 32 on the same 16 lanes. First-seen voucher receipt is one cold operation. For the unchanged workload of **100 outbound transfers and 100 inbound transfers per day**, including one new trace, packet-only wallet depletion is **807.68 ADA ($157.03) per day**. The preceding report measured 807.66 ADA. These packet costs are essentially unchanged. Small differences include fixture wallet-selection variation. The material new saving comes from client updates. Recipient funding and gross protocol reserve flows are unchanged.

The packet-only 30-day funding is **24,230.32 ADA ($4710.86)**. The observed wallet-shape assumption separately reserves **1,200.00 ADA** as collateral. Adding the 10 ADA spendable reserve gives **25,440.32 ADA ($4946.11)** of peak funding. Collateral is reserved capital. Client maintenance and pruning are added explicitly below. Injective daily fees, hosting and operator time remain outside these figures.

The ready-pair fixture keeps sends single and measures acknowledgements that are already available at the same proof height on distinct lanes. All 16 of 16 pair candidates fit the Gateway's 20 percent execution and size margins. Observed peak memory is 13,052,454 against a 16,500,000 limit. Warmed wallet debit per transfer falls from 3.871289 to 3.168376 ADA. This does not establish a production pairing rate. The runtime submits a singleton immediately and adds no collection timer.

#### Complete Tendermint updates

The client benchmark uses the same captured 45-validator Injective header in all four profiles. It retains all 45 validator entries and selects 17 of the 43 available signatures. General-path controls also select six trusted-set membership proofs. The current contracts and builder still use batches of 24 for the unchanged-set path and trusted-set reconstruction. General-path membership batches stay at six. Each client row is one cold complete update rather than a warmed mean. The forced general path measures the extra work and does not reproduce actual validator churn.

```sh
python3 scripts/benchmark/tendermint-costs.py /tmp/tendermint-costs --deno deno
```

The driver passes the fixture's supported batch, quorum and general-path options. It retains the derived runner, source hashes, signed CBOR, reference-script bytes and wallet checks. A fixed public test mnemonic makes wallet selection repeatable. Client creation, stake registration and reference publication precede measurement. The fixture's 30 ADA client-reference seed during finalization is recorded separately and excluded from income. Finalization updates the client and HostState roots, archives the old checkpoint and burns the session token.

| Complete update | Previous fees in ADA | Current fees in ADA | Transactions | Current USD |
| --- | ---: | ---: | ---: | ---: |
| Unchanged set, batches of 24 | 6.536141 | 4.811116 | 4 | $0.94 |
| General control, trusted batches of 24 and membership batches of six | 13.511309 | 9.150311 | 12 | $1.78 |
| Unchanged set, batches of six | 10.072004 | 7.397605 | 10 | $1.44 |
| General control, batches of six | 17.046098 | 11.735157 | 18 | $2.28 |

The unchanged-set profile is **26.4% cheaper** than the preceding report. The general-path control is **32.3% cheaper**. Their transaction counts remain four and twelve. The savings include the merged finalization, witness-selection and forwarding work. The forwarding change alone saved about 0.234 ADA per update in its controlled comparison. Wider batch-limit redesigns and exploratory removal of checks are excluded. No waiting window is introduced.

| Fee component in ADA per complete update | Unchanged set, batches of 24 | General-path control |
| --- | ---: | ---: |
| Fixed and signed-transaction-size fees | 1.449164 | 3.459176 |
| Execution fees | 2.062368 | 3.008103 |
| Reference-script fees | 1.298880 | 2.680920 |
| Builder margin | 0.000704 | 0.002112 |
| Total | 4.811116 | 9.150311 |

Reference charges are calculated from the resolved script bytes using the retained 15 lovelace/byte parameter and the ledger's [tiered reference-script rule](https://developers.cardano.org/docs/learn/core-concepts/fees/). The ordinary finalization references **50,730 bytes** and costs **2.176019 ADA**, including **0.836340 ADA** in reference-script fees.

The unchanged-set session temporarily holds **5.115970 ADA** and releases it at finalization. Net protocol reserve growth is zero in this prefunded fixture. The reserve is separate from update fees. These compiled validators require a deployment built from current main. The [recorded setup comparison for the forwarding change](https://github.com/cardano-foundation/cardano-ibc-incubator/pull/972#issuecomment-6532325557) adds 0.379033 ADA in fees and 23.463800 ADA of refundable staking and reference-output reserves with separate script publications. Daily examples assume this setup is already funded.

#### Daily funding including client maintenance

Update frequency is an explicit input. For the same 200 transfers per day, singleton examples assume 100 receive proof heights and 100 acknowledgement proof heights. The ready-pair example assumes 100 receive heights and 50 acknowledgement heights. There are no additional idle refresh updates in these examples. Proof-height reuse and the proportion of unchanged sets are not inferred from the fixture. No additional monetary saving is assigned to concurrent-worker coordination.

The following table preserves the preceding report's scope for comparison. It excludes receipt pruning from both previous and current values. The recurring cleanup cost is added in the next table.

| Cardano funding scenario before receipt pruning | ADA per day | USD per day | USD over 30 days |
| --- | ---: | ---: | ---: |
| Single packets and 200 unchanged-set updates | 1,769.90 | $344.10 | $10323.12 |
| 50 already-ready acknowledgement pairs and 150 unchanged-set updates | 1,459.05 | $283.67 | $8510.07 |
| Single packets and 200 general-path control updates | 2,637.74 | $512.83 | $15384.88 |

The 200 unchanged-set updates alone cost **962.22 ADA ($187.08) per day**. The singleton unchanged-set case falls from **2,114.89 to 1,769.90 ADA per day**. At the common new quote this is **$411.18 to $344.10 per day**. The same-scope saving is **16.3%**, or **$67.07 per day and $2012.20 over 30 days**. Lower proof-height counts in the ready-pair scenario must not be credited again as an independent coordination saving.

#### Receipt pruning

The new cleanup sample signs and submits one prune after the 32 existing-voucher receives. That lane contains two retained sequences before cleanup. The prune removes one receipt and acknowledgement using a counterparty commitment-absence proof. It costs **1.809451 ADA ($0.35)**, including **0.783834 ADA** for **47,813 referenced script bytes**. Its prerequisites are already recorded in the receive profile and are not charged again in the pruning profile. This is one signed sample and does not establish a warmed pruning mean or batch saving.

Long-running traffic must pay for this cleanup. At one eventual prune for each of the 100 inbound transfers, pruning adds **180.95 ADA per day**. Outbound Cardano source commitments are removed during acknowledgement processing. The current prune builder cleans received receipts and acknowledgements. Pruning preserves the lane's existing ADA rather than automatically refunding its reserve to the relayer.

A prune also needs a usable client state for its absence-proof height. The first example below assumes it can use heights already accepted by packet updates. The second assumes 100 additional distinct heights and therefore 100 more unchanged-set updates. Both include the same 200 transfers and 100 single-sequence prunes. They illustrate different proof-height reuse assumptions and do not establish a production cadence or latency result.

| Cardano funding including receipt cleanup | ADA per day | USD per day | USD over 30 days |
| --- | ---: | ---: | ---: |
| 100 prunes reuse usable proof heights from the 200 packet updates | 1,950.85 | $379.28 | $11378.50 |
| 100 prunes each require an additional update, 300 updates total | 2,431.96 | $472.82 | $14184.63 |

The client fixture selects 964.52 ADA of collateral input value while declaring 5 ADA per transaction. That large input returns on success and reflects wallet shape. The JSON records conservative peaks for four such inputs plus temporary session reserves. A dedicated-collateral wallet policy has not been qualified. Hosting, extra refreshes, retries and Injective daily fees still need separate inputs before treating these scenarios as a complete operating budget.

#### Injective comparisons

The October 30 native Injective replay is retained. It uses 64 bodies and 32 headers from a five-pool local Cardano ledger with one transaction-bearing block and a controlled clock. All 126 recorded runtime Go source hashes still match current main. No new native replay or public-testnet transfer is claimed in this refresh. The twenty live Hermes observations remain historical October 29 evidence from 13-pool signed fixtures with 24 confirmation headers.

| Available bodies and retained measurement | One-body complete update fee in INJ | Adaptive complete update fee in INJ | Fee reduction |
| --- | ---: | ---: | ---: |
| 1 body, live Hermes median | 0.0103862800 | 0.0103723015 | 0.1% |
| 4 bodies, live Hermes median | 0.0122104730 | 0.0113448160 | 7.1% |
| 64 bodies, native replay | 0.071107745 | 0.059337156 | 16.55% |

The retained native replay reduces body submissions from 64 to 16 and total transactions from 75 to 27. Both wallets reconcile and reach the same verified checkpoint. Its gas price remains 500000000 INJ base units per gas with a 1.8 multiplier. The 75% reduction applies to body-transaction count. The measured complete-update fee reduction is 16.55%. Four bodies remains a ceiling and introduces no collection timer. These transport savings are not credited a second time as a new improvement. A daily INJ budget still needs observed update frequency, backlog, stake-table changes and source activity.

The packet report, journal and client-update artifact contain the new measurements. The counterparty artifact adds current source-identity verification while preserving its original fee observations. The October 28 idle resource sample stays historical. The five compressed files total about 0.8 MB. Paths and hashes of uncompressed evidence are in `relayer-cost-baseline.json`. For example:

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

The lab cost report and a short resource collection do not complete #735. The qualification still needs numeric budgets agreed before the run, real two-chain traffic and client maintenance, live wallet reconciliation, database/WAL and retained-state measurements, sustained pruning, fault recovery and infrastructure pricing. Local devnet memory and storage cannot establish the cost of a fully synced production node. Quote hosting and RPC costs for the selected architecture separately. Keep those prices and dates with the results. Do not present the transaction-only funding projection as a complete monthly operating cost.
