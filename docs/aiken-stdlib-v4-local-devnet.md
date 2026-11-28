# Aiken stdlib 4 local devnet trial

This branch upgrades `aiken-lang/stdlib` from `3.1.0` to `v4.0.0` on top of
`7294fb8e`. The compiler stays at `v1.1.24` and the project's fuzz dependency
stays at `v2.2.0`. The source changes use the renamed `cardano/assets.Assets`
type. The separate builtin `Value` operations and the Scalus constant-decoding
workaround in `native_value.ak` are preserved.

The baseline and upgraded production blueprints have identical datum
definitions. Wire schema version 7 and its 44 protected definitions pass the
existing compatibility guard without changing the schema lock. Of the 130
blueprint entry points, 36 have different compiled bytes. The applied
channel-upgrade deployment hashes were regenerated from the upgraded
blueprint. Stable datum encoding does not imply stable script identities or
qualify this change as a migration for an existing deployment.

The contract suite passed 2,244 tests with seed `20261127`, including 89
properties at 100 iterations each. The deployment tests exercised signed
reference-script publication at the production transaction-size limit. Their
old deployment hash fixture initially failed and passed after regeneration.

A fresh local Yano deployment published 53 reference scripts and passed the
shutdown authorization checks before and after a cold restore. A post-restore
mint was adopted and snapshot reset removed it. The Go light-client decoder
also read a 648-byte HostState datum captured from that deployment. Its root
matches the root decoded independently with Lucid. The retained vector is
`tests/ibc-state-commitment/stdlib-v4-host-state.json` and the regression is
`TestStdlibV4DeployedHostStateDatum`.

The production Gateway packet rehearsal passed on both the fresh deployment
and its cold restore. It sent five valid funded intents in batches of two,
two and one while ignoring seven unusable requests. All five packets were
sent before acknowledgements. Concurrent acknowledgements used disjoint
wallet inputs, an occupied lane was deferred before evaluation, and a consumed
reference caused a rebuild. The counterparty headers and proofs are test
fixtures rather than a running Cosmos chain.

Use Aiken `1.1.24` and Deno `2.9.6`. From `cardano/onchain`:

```sh
aiken build --deny --trace-level silent
aiken check --deny --seed 20261127 --max-success 100
```

From the repository root:

```sh
node scripts/ci/check-aiken-wire-schema.mjs check --base-ref origin/main
node cardano/gateway/scripts/prepare-local-deps.cjs
npm run --prefix cardano/gateway build
```

From `cardano/offchain`, run `deno task test:deployment`. From
`cosmos/cardano-probabilistic-light-client-core`, run
`go test . ./cardanodatum ./commitmentcodec`.

The local integration uses Yano `0.1.0-pre19`, the same release as CI.
Point `YANO_DISTRIBUTION` at its extracted distribution directory. Choose a new
output directory for each run:

```sh
python3 scripts/ci/yano_snapshot.py --suite packets \
  --distribution "$YANO_DISTRIBUTION" \
  --cache .deployment-smoke/stdlib-v4-packets-cache \
  --output .deployment-smoke/stdlib-v4-packets-run \
  --force-fresh --compare-fresh
```

Yano exercises locally signed transactions and compiled scripts with its
ledger and Scalus evaluator. These results do not establish a five-producer
Cardano-node/Cosmos/Hermes acceptance run or compatibility with an already
deployed bridge. The public-network deployments and decoder implementations
are unchanged.
