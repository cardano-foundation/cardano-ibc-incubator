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
   same 15,634-byte output guard (16,384 minus the 750-byte reserve). A runtime
   budget exception cannot bypass this deployment check.
4. Aiken tests check HostState authorization, state transitions, client token
   authenticity, shutdown behavior, packet timeouts, and transfer value
   preservation. Property tests exercise negative cases as well as valid updates.

The CI reference-deployment report uses the largest **applied** output estimate,
then adds its existing conservative signing allowance. Its modeled signing
reserve ratchet is separate from the mandatory reference-output guard and the
actual signed-transaction ledger limit. Any remaining runtime budget overruns
remain visible in the report; passing deployment checks does not prove that every
maximum-capacity IBC operation fits the ledger.

## Local verification

From `cardano/onchain`, run:

```sh
aiken build --deny --trace-level silent
```

Then from `cardano/offchain`:

```sh
deno task test:deployment
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
