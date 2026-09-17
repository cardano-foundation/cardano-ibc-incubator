# Compatible implementation migration operator runbook

This feature supports fresh `cardano-ibc-compatible-v1` baselines and repeated successors of that baseline. An existing immutable bridge without this mechanism must be rejected. Copying its datum or redeploying the same channel names is not migration.

Release acceptance remains conditional on the evidence recorded in the migration implementation report. Do not use the local rehearsal clock images, public devnet keys, or test successor constraints on a public network.

**Incident limitation:** there is currently no immediate on-chain emergency pause. A replacement proposal does not stop ordinary transfers or settlement; the stop begins only after the approval delay and a valid `Begin`. Shutdown is disabled for this profile, and stopping Gateway/Hermes cannot stop third-party submissions. Once `Moving`, anyone can finish and activate the approved target: there is no independent emergency veto. See the [containment audit and executed controls](emergency-containment-audit.md). Add and validate an independent restriction capability before treating migration as an emergency-response procedure.

For the owned magic-42 rehearsal only, `scripts/ci/advance-migration-clock.py --runtime … --project … --file-clock --seconds …` advances isolated producer clocks in steps of at most 300 seconds, requiring all five producers to reach advanced-window points in the same canonical history, complete nonce history and captured ledger stake between steps. A progressing single producer is insufficient; a partition stops the helper before further advancement. Stop Gateway and Hermes first; Cosmos is synchronized at completion. `--resume` reconciles an interrupted bounded step before advancing the additional requested seconds (`--seconds 0` reconciles only). A failed or inconsistent intent remains on disk and stops further advancement. Alternatively, `--until-ms <ready_at_plus_buffer>` advances until an actual canonical block reaches the approval timestamp, counting normal elapsed time as well as injected steps. It is mutually exclusive with `--seconds`. Captured epoch stake can be reused only after checking the snapshot genesis, raw ledger digest and canonical capture point (`capture-migration-stake.py --reuse-canonical-epoch`). Restart operational processes with the recorded `clock-state.json` offset. This helper neither shortens the approval delay nor demonstrates public-network finality.

The standalone transaction-builder SDK requires the configured Ogmios `evaluateTransaction` service. It constructs from confirmed ledger inputs, propagates evaluation failures, and verifies final aggregate execution units against fresh ledger limits. Unconfirmed transaction chains or operator-supplied evaluator input substitutions are unsupported.

## Prepare and review

For a new baseline, supply `MIGRATION_GOVERNANCE_FILE` to the existing `cardano/offchain/index.ts` deployment entry point. Its JSON contains explicit `signers` (distinct payment-key hashes), `quorum`, and `delay_ms` (at least `86400000`), with numeric fields encoded as decimal strings. Omitting the file selects the legacy deployment path; it does not create an upgrade-capable bridge. The standard single-wallet entry point supports a bootstrap authority signed by that explicitly configured wallet. Threshold bootstrap uses `createDeployment` with an explicit `bootstrapSigners` quorum and `signRegistryBootstrap` callback that returns the fully signed transaction; missing signing support fails before deployment. Later approvals can use the unsigned export workflow below. Never substitute rehearsal authority keys for production custody.

Retain the original handler, applied baseline scripts, complete history bootstrap, compiled successor blueprint, toolchain versions, and plan artifact. Back up retained Yaci transaction/body history independently of disposable Gateway consensus-history and tree caches. Confirm the supported counterparty's client is live/recoverable and its trust period and packet timeouts accommodate the approval delay and execution window. This profile does not install generic channel-upgrade support or change the counterparty client type.

Build the successor with Aiken 1.1.21 using `aiken build --deny --trace-level silent`. Review the exact five applied spending scripts and their complete addresses, the original retained policy inventory and compatibility commitment, source generation, nonce, captured counts/inventory, and activation window. Approving replacement code authorizes its future behavior, including potential theft; conservation at handover does not remove this governance trust.

Use the pinned Deno 2.9.6 toolchain and install the locked npm/Deno dependencies, including the local checksum-pinned evaluator. Older Deno versions can rewrite lockfile metadata and are not the tested toolchain. Gateway installation and the off-chain deployment test verify its artifacts and transitive resolution. See [evaluator provenance and reproducible build](../cardano/vendor/uplc/README.md); do not substitute a registry package or alter cost models/budgets to make evaluation pass.

Set explicit `KUPO_URL`, `OGMIOS_URL`, and `CARDANO_NETWORK_MAGIC`. The migration command does not automatically load `.env.default`. Read-only commands require no signing key. From `cardano/offchain`:

```sh
deno task migrate:deployment inspect --handler /artifacts/handler-v1.json
deno task migrate:deployment prepare --handler /artifacts/handler-v1.json \
  --blueprint /artifacts/reviewed-v2/plutus.json --out /artifacts/migration-v2.json
```

The output is created exclusively. Preserve its reported canonical-JSON SHA-256, not just a filename. Preparation does not authorize a transition. If core creation, escrow inventory, or referenced preparation inputs change before approval, prepare and review a fresh artifact.

## Publish and authorize

Provision a separate executor wallet with fees, collateral, and reference/minimum-ADA deposits. `MIGRATION_EXECUTOR_SK` supplies its key explicitly. Executors do not need governance keys for approved execution. Bridge principal and preexisting state/deposit value cannot pay migration costs.

```sh
deno task migrate:deployment publish --handler /artifacts/handler-v1.json \
  --plan /artifacts/migration-v2.json --outbox /artifacts/v2-outbox --submit
```

Publication reuses canonical script references and journals exact signed bytes before broadcast. Keep the outbox until canonical completion has been independently checked. Concurrent executions sharing the same outbox publish immutable signed revisions. The journal is reconciled before transaction construction, so an accepted action does not need fresh funding or signing. Separate outboxes can fund redundant reference publications; operators must coordinate executor funding.

For a threshold authority, export an unsigned approval body and collect the existing required signatures using the normal custody/signing workflow. `--signers` is a comma-separated list of distinct payment key hashes, not private keys. The expiry is an explicit POSIX millisecond timestamp, and must allow the on-chain minimum delay of at least 24 hours plus execution time. CLI validity bounds come from the canonical Cardano tip.

```sh
deno task migrate:deployment authorize --handler /artifacts/handler-v1.json \
  --plan /artifacts/migration-v2.json --signers "$GOVERNANCE_KEY_HASHES" \
  --expires-at "$EXPIRY_POSIX_MS" --wallet-address "$EXECUTOR_ADDRESS" \
  --out /artifacts/approval-unsigned.json
```

The exported body identifies required signers and source registry input. Collect and submit signatures over that exact body. A stale input requires rebuilding and re-signing; do not transplant witnesses. For an explicitly configured single-wallet rehearsal authority, `--submit` signs with the configured wallet. The CLI does not implement a remote signer or automatically collect a multisignature quorum.

Approved replacement freezes new core objects and new escrow shards while existing-object settlement can continue. Cancellation needs governance approval before expiry, and is permissionless after expiry. `cancel` builds that transaction. `rotate` takes explicit `--governance` JSON and follows the same delayed proposal mechanism; `activate-authority` executes a mature approved rotation. Rotation is unavailable during an active replacement.

## Execute and resume

After the delay, each execution reads canonical registry state. Begin moves HostState and freezes its authenticated inventory/counters. It is irreversible in this profile. All ordinary HostState operations then stop, including sends, receives, returns, acknowledgements, timeouts, client-update finalization, refunds and pruning. Counterparty packets can still arrive or time out; they must settle after activation. Session verification/cancellation uses retained scripts; final client application waits.

```sh
deno task migrate:deployment execute --handler /artifacts/handler-v1.json \
  --plan /artifacts/migration-v2.json --outbox /artifacts/v2-outbox \
  --max-steps 1 --submit
deno task migrate:deployment inspect --handler /artifacts/handler-v1.json
deno task migrate:deployment resume --handler /artifacts/handler-v1.json \
  --plan /artifacts/migration-v2.json --outbox /artifacts/v2-outbox \
  --max-steps 20 --submit
```

Steps move one authenticated object plus the registry. A step limit is not completion. An indexer inventory mismatch must stop execution and trigger canonical index refresh; it is not permission to omit an object. Receipts, packet commitments, sequences, refund/remint obligations, voucher identities, and escrow balances remain unchanged during moves. Neither generation services ordinary traffic during this mixed-custody period.

Activation needs a proof for the transfer port's old commitment. With the current retained history database configured, from `cardano/gateway`:

```sh
npm run export:migration-witness -- /artifacts/handler-v1.json /artifacts/activation-witness.json
```

This command reconstructs the historical tree, checks it against canonical HostState, and rechecks the snapshot after the read transaction. Then resume with `--port-witness /artifacts/activation-witness.json`. The validator verifies the exact old-to-new transfer-registration commitment; it never accepts an operator-provided replacement root.

On crash, rejected submission, stale index, or competing executor, inspect canonical registry/NFT state before continuing. Signed-transaction journals are submission evidence, not a progress authority or finality certificate. A lost RPC response is handled by querying the signed hash and rebroadcasting the same bytes. For reference publication and its funding, the CLI can replace an expired transaction only after the canonical node tip passes its signed expiry and the original normal-input anchor remains unspent. Every replacement spends that same original input, preserves all prior signed revisions, and rechecks every revision for canonical adoption. A rollback can make an earlier revision canonical. Missing history, a spent anchor without identified adoption, or an unsupported journal format fails closed. Do not delete or edit a journal on an assumed failure. Governance signatures are never reused on a rebuilt body; exported approvals still require rebuilding and re-signing.

A chain rollback can invalidate observations and manifests. Wait for the network's operational finality policy and independently recheck registry custody, all expected objects, the exact current generation/addresses, retained references, and history readiness. No command claims deterministic finality from a single indexer response.

The history worker's `complete-block-v2` cursor waits for all transaction bodies, inputs and outputs of each canonical transaction-bearing block. Missing asynchronous Yaci rows stop progress without advancing the cursor. On first initialization of this cursor, older derived bridge projections and chain-derived pool-age caches are rebuilt from retained canonical tables; raw chain data and independently sourced genesis/external cache entries are preserved. Allow replay to catch up before continuing migration or proof service. Do not manually advance the cursor or fill missing state from an operator inventory. Rollback rewinds to a retained matching checkpoint and rebuilds chain-derived registration ages; the indexer is their sole cache writer. Monitor the last complete block and retained errors, rather than treating the latest Yaci header as proof that projection replay has completed.

## Install and verify

```sh
deno task migrate:deployment verify --handler /artifacts/handler-v1.json \
  --plan /artifacts/migration-v2.json --out /artifacts/handler-v2.json
```

Verification checks the active implementation, immutable applied policy inventory, authenticated token identities, role custody, and remaining inventory. Its receipt describes the supplied artifact digest and observed registry output. It does not attest a historical approval transaction or certify complete historical replay.

Export the normalized public manifest through the existing Gateway `export:bridge-manifest` command, which verifies retained history coverage and hash-checked HostState mint evidence. Install the new handler in Gateway configuration and the normalized manifest at Hermes' explicitly pinned `bridge_manifest_path`. Restart Gateway/history services and Hermes so cached addresses and signer policy refer to the active generation. Retain original addresses and transaction history for cold replay. Restore historical client proofs before clearing old packets, then verify old redemption, timeout/refund/remint, and new transfers on the existing routes.

Historical recovery can start with `GATEWAY_HISTORICAL_READ_ONLY=true` and the retained manifest/history database while the live generation is moving or its new manifest is not yet installed. Bootstrap history is authenticated at startup; individual historical queries verify the requested canonical HostState/root and stability anchor. HTTP transaction builders, gRPC transaction endpoints, and the shared transaction runner reject operations for the lifetime of that process. Restart with the verified active manifest and normal mode to resume building. `/health/ready` remains ordinary current-root readiness and may return 503 in recovery mode; do not use it to route historical-only access or treat recovery startup as transaction readiness. The migration rehearsal establishes this continuity path for the stake-weighted probabilistic Cardano client; equivalent Mithril historical certification has not been established.

At an epoch boundary a recent HostState transaction may lack enough same-epoch descendants for the probabilistic light client. The existing root-preserving heartbeat can create a new anchor in the next epoch. The explicit `hermes tx host-state-heartbeat --chain <cardano-chain>` command uses the ordinary heartbeat authority, transaction builder, independent signing checks and node submission. It neither bypasses registry freezing nor lowers proof thresholds. Wait for the new anchor to satisfy the configured thresholds before relaying. A concurrent HostState spend requires rebuilding the request from canonical state; do not reuse the rejected body.

Repeat preparation from the verified V2 handler for V3. The original applied immutable policies remain the baseline throughout; never recompile/reissue them as new asset identities.

## Populated rehearsal evidence

The manual `Populated migration rehearsal` workflow builds the actual validators, Gateway, Hermes and counterparty, deploys a fresh five-pool baseline, and invokes `scripts/ci/test-populated-migration.py`. It is also callable through the existing CI workflow's `populated_migration=true` dispatch input, allowing a feature branch to run before the new workflow reaches main. Routine checks and the long rehearsal use separate concurrency groups. Repeated CI dispatches with `populated_migration=true` on the same branch share a parent concurrency group: wait for the previous run to finish before dispatching another, or its remaining jobs will be cancelled. Consult the evidence ledger for completed results; an in-progress run is not acceptance. On an already deployed fresh owned baseline, the equivalent command is:

```sh
python3 scripts/ci/test-populated-migration.py \
  --runtime .deployment-smoke/OWNED_RUNTIME \
  --artifacts-dir .deployment-smoke/BASELINE_ARTIFACTS \
  --v2-blueprint .deployment-smoke/release-v2/plutus.json \
  --v3-blueprint .deployment-smoke/release-v3/plutus.json
```

This driver requires five-day epochs, explicit disposable governance, distinct compatible successor fixtures, and the full on-chain approval delay. It populates two existing channels, exits the execution process after Begin, starts a historical-only Gateway with a unique empty cache, resumes custody moves, installs the verified manifest, and repeats for V3. It checks both Gateway ports before Begin and only stops process groups it created. Stop other rehearsal workers explicitly before invoking it. `--from-stage` and `--through-stage` select an explicit continuation; they do not make an ambiguous submission safe to retry. Partial handover evidence may require manual canonical reconciliation with the production CLI before continuing.

`--from-stage verify-all` rechecks every packet receipt and every custody transaction against canonical block data, reruns state conservation and independent funding arithmetic, and checks final native/foreign balances. It binds each handover to the exact genesis, deployment, generation, role addresses and approved plan, and requires an old packet's Cosmos acknowledgement to use a proof height after the selected activation. It never treats a local result filename or journal as success. The workflow retains only allowlisted public artifacts, including the exact genesis and public wallet-population metadata; signing keys and chain homes are excluded. Retain raw canonical history separately if future revalidation is required.

The owned rehearsal uses two holder wallets and a third ADA-only migration executor. `migration-wallet.ts` records its separate funding transaction; `migration-control.py --executor migration` selects that public disposable fixture without loading operator keys. The approval authority and the custody executor remain separate. Reference publication and approval have their own funding costs.

`migration-rehearsal-traffic.py --phase populate` creates the native/foreign population and pending obligations through real Hermes and Gateway transactions. After V2 activation, `--phase settle-v2` settles old receive, return, timeout and remint paths and sends new traffic. Five acknowledgements deliberately remain pending across V2→V3; `--phase settle-v3` settles those and completes new traffic in both directions. Each invocation requires explicit `--runtime`, `--artifacts-dir`, `--clock-offset-seconds` and two `--cosmos-channels`. Receipts are reused only after checking canonical inclusion, exact packet payload/redeemer, and the original routes. An interrupted attempt without a receipt stops for inspection; never delete its log to force a replay.

For a completed settlement whose receipt capture failed, `--step STEP --reconcile-log` reads the retained successful Hermes log and verifies canonical inclusion without sending any transaction. It refuses unresolved sends because their original destination timestamp bounds are separate evidence. Cosmos acknowledgement events omit packet data; the verifier obtains the expected payload from the original canonical send and independently checks the full `MsgAcknowledgement` at the emitted event's exact message index, including the CometBFT transaction data commitment. A success log or matching sequence alone is insufficient.

For a specifically recognized application-status or channel-initialization read failure, `--retry-read-failure STEP` permits an explicit retry after checking all retained attempts for that error and absence of construction/submission messages. It retains each attempt in a separate log and refuses ambiguous failures. This log check does not prove absence of a transaction on-chain: inspect canonical state first, and let Hermes and the validators recheck the pending obligation. Do not use this option for a lost submission response or a partially submitted client update. The top-level driver forwards it to the first selected settlement phase only.

The owned fixture exposes its node witness endpoint on loopback `127.0.0.1:23001` and explicitly configures Gateway's node host, port and network magic. Yaci remains the primary block-CBOR source. The node fallback must establish a non-query handshake, accept the configured network, and complete within bounded deadlines. Production operators must configure their own authenticated chain data sources; do not copy the disposable fixture endpoints.

Capture quiescent snapshots using `capture-migration-population.ts OWNED_RUNTIME HANDLER NEW_SNAPSHOT_JSON`. The capture authenticates the complete local inventory and also records the original Cosmos escrow balances at a fixed counterparty height. `verify-migration-traffic-balances.py` independently checks the exact per-shard backing, original voucher identities, both holders, and remote escrow addresses/balances for `populated`, `settled`, or `settled-v3`. It requires the expected generation and genesis digest explicitly.

Capture a second snapshot after approval, before Begin, to isolate execution costs. Measure every accepted custody transaction with `measure-migration-transaction.cjs OWNED_RUNTIME TX_HASH NEW_REPORT_JSON`; then run `verify-migration-funding.py APPROVED_SNAPSHOT ACTIVE_SNAPSHOT REPORT...`. It requires exactly one move per object plus activation, no mint/burn, only the separate executor's signature, transaction limits, and an executor ADA decrease equal to fees plus added infrastructure deposits. Compare the pre-approval and post-activation snapshots separately with `verify-migration-population.ts` to check the full state/asset handover and the exact committed port transition. These observations do not certify public-network finality.

The disposable five-pool fixture must have a genesis before the supported client's fixed January 1, 2026 producer-registration cutoff. Use `--clock-offset-seconds "$(python3 scripts/ci/migration-clock-profile.py)"` when creating the fresh baseline. This computes a relative offset once for December 29, 2025; all producers retain it across restarts. A genesis after the cutoff can never qualify its pools, regardless of additional blocks. Both baseline and rehearsal preflights reject that configuration. Do not change verifier thresholds or invent older registration evidence. Public readiness responses, including HTTP 503 causes, are recorded in the rehearsal's `gateway-readiness-*.log` files.

## Emergency limits

There is no rollback after Begin and no terminal shutdown/retirement for this baseline. Keep all fixed scripts, policies, metadata, trace registry, proof/history resources and operational deposits needed by outstanding claims. A deployer or relayer cannot sweep them through the legacy shutdown tooling.

Migration entry is separate from ordinary HostState/client/channel/transfer dispatch, but still depends on working immutable policies, authentic state tokens, the registry kernel, and Cardano transaction availability. Bugs in those immutable components can be unrecoverable. A successor that violates this migration ABI or changes state/schema/policies outside the approved compatibility profile is unsupported. Authority loss, a malicious approved implementation, permanently expired unrecoverable clients, and missing historical proof data are not solved by this mechanism.
