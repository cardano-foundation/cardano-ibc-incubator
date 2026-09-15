# Deployment validation

A production build must be deployable with the public-network transaction limits.
Build with Aiken 1.1.21 and `--deny --trace-level silent`; tracing changes script
sizes and execution budgets.

## Checks that run in CI

1. `cardano/offchain/src/deployment-plan.ts` applies the real deployment parameters
   and records each loaded script's publication role. Production consumes this
   plan. The complete reference inventory is checked before the first submitted
   transaction, including when a nonce-split transaction must first be built.
2. `deno task test:deployment` checks both production and local-benchmark plans,
   parameter dependencies, and failure before any submission. It also balances,
   signs, and submits reference publications and inline bootstrap mints through
   Lucid's Emulator using the production transaction builders. These tests measure
   the signed CBOR, fees, witnesses, outputs, and dedicated funding path.
3. `deno task export:deployment-plan --output ../../deployment-plan.json` exports
   both fully applied inventories. The Gateway budget check requires this fresh
   artifact and verifies its blueprint SHA-256. Every reference must satisfy the
   same 15,634-byte output guard (16,384 minus the 750-byte reserve).
4. Aiken tests check HostState authorization, state transitions, client token
   authenticity, shutdown behavior, packet timeouts, and transfer value
   preservation. Property tests exercise negative cases as well as valid updates.

The CI reference-deployment report uses the largest **applied** output estimate,
then adds its conservative signing allowance. Synthetic execution estimates are
diagnostic only. `deno task test:tx-budgets` enforces ledger limits on evaluated,
signed transactions. Passing these checks does not prove that every
maximum-capacity IBC operation fits the ledger.

`deno task test:shutdown` evaluates complete cleanup transactions for both legacy
and staged clients, including refunds and recovery staking-deposit reclamation.
It also checks that staged cleanup rejects active deployments, an unelapsed
grace period, missing authority, missing token burns, incorrect refunds and
legacy reclaim redeemers. Staged reclaim uses constructor 4; existing staged
update, recovery and misbehaviour constructors keep their indices.

### Shutdown properties

`deno task test:shutdown:fuzz` runs three shrinking properties against the compiled
validators, with local UPLC evaluation and signed transaction size and execution
budget checks:

- **Deployment sequences:** fund one genesis wallet, run the production deployment,
  create clients and connections, verify connection acknowledgements and create
  ordered/unordered mock channels, vary HostState ADA top-ups, enter shutdown with
  different grace periods, and reclaim state in different orders. The independent
  model checks object counts after every command. Completion inspects the entire
  emulator ledger, including reference outputs, and requires no output outside
  the payout wallet and `returned ADA + all transaction fees = genesis ADA`.
  Recovery stake deregistration and its deposit refund are included. Tests also
  require an executed script to reject reference reclamation during the grace
  period.
- **Populated snapshots:** reuse the existing cleanup fixture, varying consensus
  history length, settled channel receipt/acknowledgement counts, extra ADA,
  user-held voucher quantities, client variant and cleanup order. Empty escrow
  shards, transfer/module roots, clients, connections, channels, trace state and
  voucher metadata are reclaimed with production builders. A separate ledger
  balance check requires every seeded state deposit back, less actual fees, and
  verifies that user vouchers are preserved. Each case also requires script
  rejection of a mutated client reclaim (authority, burn, refund or shutdown
  timing). These assumed snapshots test cleanup
  policies; they do not demonstrate how the populated state was reached.
- **Drain before reclamation:** begin with an active snapshot containing funded
  native escrow and either an outstanding outbound packet or a proven incoming
  return. Fund snapshot deposits from the real deployment wallet, preserving
  total ADA. Evaluate a valid native deposit while active, then enter shutdown and
  require that deposit to fail script evaluation. Execute a timeout refund, an
  error-acknowledgement refund, or an incoming native return with verified ICS-23
  proofs. Assert the exact payout to a separate user wallet, zero escrow balance,
  and no outstanding local packet commitment. Reclaim the emptied shard, all
  other deployment state, references and staking deposit, then check the entire
  ledger against genesis ADA minus transaction fees. Amounts, grace periods and
  settlement near the grace deadline vary; no ledger state is seeded or edited
  after shutdown entry. The three deterministic drain scenarios also run under
  `test:shutdown`.

The default is 20 cases per property. Failures print a seed, shrink path and
counterexample. Replay only the failed property, for example:

```sh
TX_FUZZ_RUNS=100 TX_FUZZ_SEED=611 deno task test:shutdown:fuzz
TX_FUZZ_SEED=611 TX_FUZZ_PATH='<reported path>' deno task test:shutdown:fuzz --filter 'stateful main lifecycle'
```

The generated deployment sequences currently stop at channel initialization;
they do not generate client update sessions or end-to-end transfer histories.
The populated-snapshot property assumes settlement; the drain property executes
the native settlement paths from an unsettled starting snapshot. It does not yet
generate voucher-return sends or the preceding transfer/client-update history.
Existing negative tests check that outstanding packets and user deposits block
reclamation. Consequently these results establish tested reclamation paths,
not an unconditional claim that any deployment can immediately return every ADA
deposit. In particular, independently owned session deposits remain subject to
the cancellation behavior described below. No lifecycle fields or accounting
rules are added to contracts by this suite.

Verification sessions are independently owned deposits, not bridge state.
Session owners should cancel unfinished work before reference scripts are
removed. Cancellation remains possible afterward by attaching the session spend
and mint scripts from the deployment manifest directly. Session creation is
permissionless, so unrelated sessions cannot prevent an administrator from
shutting down the bridge. Cleanup does not spend those deposits.

## Local verification

From `cardano/onchain`, run:

```sh
aiken build --deny --trace-level silent
```

Then from `cardano/offchain`:

```sh
deno task test:deployment
deno task test:shutdown
deno task test:shutdown:fuzz
deno task test:tx-budgets
deno task export:deployment-plan --output ../../deployment-plan.json
```

An Emulator run checks transaction construction and script evaluation. Before a
release, also deploy to a fresh Cardano devnet using the real offchain entrypoint,
with the standard transaction-size and execution limits. Verify ledger
confirmation, the resulting deployment manifest, and its published references.
Keep the signed sizes, fees, transaction hashes, and network parameters with the
run report. This catches provider, slot-clock, cost-model, collateral, and ledger
integration failures that an Emulator cannot establish.

A reproducible real-node smoke harness is available from the repository root:

```sh
python3 scripts/ci/test-cardano-deployment.py
# On a Mac using Colima:
python3 scripts/ci/test-cardano-deployment.py --docker-context colima
```

It creates a unique Docker Compose project using the checked-in public devnet
credentials, starts genesis near the real clock, checks protocol version 10 or
later, asserts the standard ledger
limits, funds the deployer, and runs the production offchain entrypoint. The
harness compares every live reference script with the exact applied deployment
inventory and records signed sizes, transaction hashes, fees, protocol parameters,
the blueprint digest, and the resulting manifest. It prints its artifact directory
under `.deployment-smoke/` and preserves the project for inspection. Use `--cleanup` to remove that project's
containers and volumes afterward. `--ogmios-port` and `--kupo-port` choose unused
localhost ports; defaults are 2337 and 2442. To reuse an explicitly selected test
project, pass both `--compose /path/to/compose.json` and `--project <name>`.

The devnet must support the byte-string builtins already used by the voucher
validator. [CIP-122](https://cips.cardano.org/cip/CIP-0122) enables these at Plomin,
which [uses protocol version 10](https://docs.cardano.org/about-cardano/evolution/upgrades/plomin).
The harness checks this before funding. A protocol-9 node can reject such a
reference as a malformed script even when its CBOR and size are valid.

The deployment suite is focused on deployment safety. It does not replace staged
Tendermint session lifecycle tests, relayer restart/retry tests, client recovery
coverage, or end-to-end packet transfer tests.
