# Tendermint upgrade proofs

This harness compares the Aiken Tendermint upgrade verifier with the pinned ibc-go keepers. It covers a move from `v8-classic-1` at `(1, 100)` to `v8-classic-2` at `(2, 1)` and an upgrade that advances within the same revision. Both profiles use those fixture chain IDs. They identify test states rather than running networks.

The generator runs in the existing v8 and v10 adapter modules with Go `1.26.9`. It checks the resolved dependency versions. The v8 profile uses ibc-go `v8.7.0`, Cosmos SDK `v0.50.14` and `x/upgrade` `v0.1.4`. The v10 profile uses ibc-go `v10.2.0`, Cosmos SDK `v0.53.3` and `x/upgrade` `v0.2.0`. These are upstream dependencies. This does not test Injective's forks.

Each case uses the real upgrade keeper to write the protobuf `Any` commitments into an IAVL upgrade store. It commits store version `99` and queries both membership proofs from the SDK multistore. The resulting root belongs to Tendermint header height `100`. The generator verifies the original proofs before making adversarial changes. It then calls the IBC client keeper's `UpgradeClient` entrypoint in a cached context. This includes the frozen and expired client checks and v10's revision-height check in its light-client module. Rejected calls discard their writes.

`vectors.json` records the committed bytes, exact proof protobufs, decoded proof operations, heights, roots, input states and reference outcomes. Integers that could lose precision in JavaScript are strings. The same proof operations feed the generated `client_upgrade_sdk.test.ak` suite. Accepted cases compare the installed client and consensus states with the reference. They also execute the Aiken proof policy and upgrade withdrawal against transaction contexts with real SDK proofs. Separate checks reject membership and non-membership against `sentinel_root`.

The cases distinguish changes to a submitted state from malicious states that were genuinely committed. They include rollback, trust-parameter substitution, altered paths, heights and roots, swapped or corrupted proofs, expiry and frozen clients. `cases.json` pins each implementation's expected acceptance. Unexpected reference outcomes stop generation and unexpected Aiken outcomes fail its tests.

The live v8 chain exposed a timestamp compatibility problem. The SDK writes its upgrade consensus state at application height `H-1`. The signed header at height `H` authenticates that commitment and has a later timestamp. Aiken and the Gateway previously rejected this valid state because its timestamp preceded the trusted header. Both now allow that ordering. Positive timestamps, expiry checks and the allowed future clock drift still apply.

There are documented differences requiring review. Aiken preserves the old trusting period like v8. V10 scales it when unbonding shrinks. A sufficiently short unbonding period is therefore accepted only by v10. A reduction that remains above the old trusting period is accepted by all three but v10 installs a shorter trusting period. Aiken also rejects a committed kernel timestamp that has expired or exceeds the allowed future clock drift. Both reference upgrade entrypoints accept those timestamp cases. The suite records these differences without treating them as a completed security review.

Regenerate with Aiken `v1.1.21` on `PATH` for formatting:

```sh
node tests/tendermint-upgrade/generate.mjs --write
node tests/tendermint-upgrade/generate.mjs --check
```

`AIKEN_FORMATTER` can select a separate formatter executable. Compile and execute with the repository's Aiken `v1.1.24`:

```sh
cd cardano/onchain
aiken check --deny -m sdk_upgrade_
```

The generated suite is a committed-store differential test. It supplies the trusted root directly. The separate [live rehearsal](LIVE.md) runs CometBFT and the production Gateway against an isolated Cardano ledger. Its retained results must be inspected before claiming a completed restart or packet transfer. A normal SDK software upgrade that preserves the chain ID and height sequence follows ordinary client updates. The revision reset here deliberately exercises the explicit IBC client upgrade operation. Issue [#918](https://github.com/cardano-foundation/cardano-ibc-incubator/issues/918) also requires an independent review of malicious upgrade plans before production use.
