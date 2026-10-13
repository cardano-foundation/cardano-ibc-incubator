# Cardano Probabilistic Light Client Core

This module contains shared Cardano/probabilistic verification logic used by the `ibc-go` versioned adapters:

```text
cosmos/cardano-probabilistic-light-client-v8
cosmos/cardano-probabilistic-light-client-v10
```

The `state` package owns header authentication, scoring, checkpoint and epoch transitions, time checks, misbehaviour, recovery, and consensus metadata. Fix these rules here once for both adapters. The root package owns Cardano block decoding, native verification, HostState extraction, and commitment proof calculation.

The core does not import `ibc-go` or `cosmos-sdk` or register protobuf types. The state machine uses the common `cosmossdk.io/store` interface. Adapters supply a small context value and a `StateCodec` that reads and writes each version's registered protobuf `Any` values. They also translate IBC paths, proof values, error codes, and module APIs.

Commitment proofs normally contain 64 sparse-tree operations. A colliding position adds one initial operation with a `0x02` prefix followed by sorted pairs of 32-byte key and value hashes. Its suffix must be empty and its hash operation must be SHA-256. The verifier checks that all entries use the requested route and that the requested record matches the committed value. An absence proof must show that the full requested key hash is missing from the bucket. The bucket then replaces the leaf for the ordinary 64-step calculation. Empty and singleton commitments retain the old encoding.

Run `node tests/ibc-state-commitment/generate-collision-buckets.mjs --check` after building the transaction-builder runtime to check the shared Gateway, Go and Aiken collision vectors. Their peer key digests are explicitly synthetic. The requested key and all value, bucket and tree hashing use native SHA-256. The tests cover malformed buckets as well as insertion, replacement, deletion, occupied-position absence and collapse back to a singleton.

The existing adapter protobufs remain the wire contract. Run `node scripts/ci/generate-light-client-models.mjs` from the repository root after regenerating them. This generates the core data structs and explicit copying conversions. CI checks these outputs and limits handwritten adapter growth. New validation and transition rules belong in `state`, not in an adapter or the conversion generator.

Run `go test ./...` and `go vet ./...` in the core and both adapter modules. State-machine regressions live in `state`. Each adapter tests its protobuf conversions, IBC error identity, and stored bytes. `testdata/state_machine_store.json` was captured from the v8 implementation on main at `96ace927` for initialization, freezing, and recovery. The fixture now includes nonce and pool registration checkpoints, settlement credit references and production history. Both adapters must reproduce those bytes, including the host revision in processed metadata. Authorized recovery discards all subject consensus roots, their proof metadata and packet checkpoints before installing the substitute checkpoint. The substitute does not establish the validity of historical subject roots. Only its copied root can become usable after the new challenge window. Clients without the required running state need an explicitly trusted new starting checkpoint.

Pool identities, VRF bindings and registration ages come from the independent registry. Stake amounts remain unsigned claims. Forward updates cannot replace an installed table for the same epoch. Historical challenges may verify an alternative table for an epoch later than their trusted checkpoint. They cannot replace the table for that checkpoint epoch. A table disagreement alone cannot freeze the client. Only incompatible authenticated block histories establish misbehaviour. This does not authenticate the actual stake allocation.

The repository builds against the local core through `replace` directives. Before publishing new adapter versions, publish a core version containing `state` and update both adapters to require that version. The existing `v0.1.5` release does not contain the new package.

Release tags for this nested module use the module directory prefix, for example:

```text
cosmos/cardano-probabilistic-light-client-core/v0.1.5
```

Hermes recovers submitted probabilistic headers from successful destination transactions. It matches the client and message position before reading the header. Rootless updates use the submitted anchor height for challenge monitoring even though they create no consensus root. Startup checks also find the first current-epoch proposal in transaction history. Both adapters return standard IBC heights to the SDK so update events use the expected `revision-height` format.

The `native-challenge.json` and `watcher-*` fixtures connect real v8/v10 keeper execution to Hermes event recovery and challenge submission. Both SDK tests then decode and verify the challenge bytes produced by Hermes. These are signed synthetic Praos blocks rather than a live mainnet challenge.

Epoch-boundary catch-up uses larger supported batches. Gateway defaults allow 96 bridge blocks and a 10 MiB encoded header. If the first settleable adjacent-epoch anchor is within that distance and fits the byte and gas budgets, catch-up can reach it in one update. Gateway also tries earlier settled anchors when the requested target has insufficient descendants. Every accepted rootless checkpoint still satisfies the same depth, pool and stake thresholds. Data or settlement evidence outside the supported bounds leaves synchronization pending.

The local destination profiles now allow 12 MiB transactions, 16 MiB blocks, 16 MiB gRPC receive limits and 20,000,000-byte RPC requests. Hermes allows 600 million gas per transaction. These are larger capacity profiles rather than snapshots of unchanged public-network limits. A production destination needs matching approved byte and gas limits before these larger updates can be used. Increasing Gateway's limit alone does not change a destination network's limits.

The boundary regressions use signed synthetic Praos blocks with complete CBOR bodies. The size case begins at a committed rootless checkpoint at height 976 before the boundary at 1000. The count case retains a checkpoint at 966 because later old-epoch anchors lack sufficient distinct stake credit. A smaller-body control also runs with the old limits. Gateway's encoded evidence is verified through both SDK keepers. The keeper tests include 4,000 pool registrations and stake rows with unchanged observed producer shares. They measure roughly 158 to 201 million gas for the large-body cases before Hermes's gas multiplier. The tests include the SDK's default transaction-size gas charge but do not measure consensus execution on a deployed validator or establish that these synthetic bodies are fully ledger-valid.
