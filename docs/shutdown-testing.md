# Shutdown validation

Build the compiled validators from `cardano/onchain` with Aiken 1.1.21:

```sh
aiken build --deny --trace-level silent
```

Then run the deterministic checks and shrinking properties from
`cardano/offchain`:

```sh
deno task test:shutdown
deno task test:shutdown:fuzz
```

`deno task test:shutdown` evaluates complete cleanup transactions for both legacy
and staged clients, including refunds and recovery staking-deposit reclamation.
It also checks that staged cleanup rejects active deployments, an unelapsed
grace period, missing authority, missing token burns, incorrect refunds and
legacy reclaim redeemers. Staged reclaim uses constructor 4; existing staged
update, recovery and misbehaviour constructors keep their indices.

## Shutdown properties

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
- **Populated snapshots:** reuse the existing cleanup fixture, varying committed
  consensus history length while keeping a singleton live tip, settled channel
  receipt/acknowledgement counts, extra ADA,
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
