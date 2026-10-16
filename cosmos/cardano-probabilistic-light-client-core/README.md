# Cardano Probabilistic Light Client Core

Only snapshot storage version `2` is supported. Inline records and single-transaction observations are rejected. The [storage and verification design](../../docs/probabilistic-bounded-verification.md) describes the bounded operations and six-hour response window.

This module contains shared Cardano/probabilistic verification logic used by the `ibc-go` versioned adapters:

```text
cosmos/cardano-probabilistic-light-client-v8
cosmos/cardano-probabilistic-light-client-v10
```

The `state` package owns header authentication, settlement qualification, checkpoint and epoch transitions, time checks, misbehaviour, recovery, and consensus metadata. Fix these rules here once for both adapters. The root package owns Cardano block decoding, native verification, HostState extraction, and commitment proof calculation.

The core does not import `ibc-go` or `cosmos-sdk` or register protobuf types. The state machine uses the common `cosmossdk.io/store` interface. Adapters supply a small context value and a `StateCodec` that reads and writes each version's registered protobuf `Any` values. They also translate IBC paths, proof values, error codes, and module APIs.

Commitment proofs normally contain 64 sparse-tree operations. A colliding position adds one initial operation with a `0x02` prefix followed by sorted pairs of 32-byte key and value hashes. Its suffix must be empty and its hash operation must be SHA-256. The verifier checks that all entries use the requested route and that the requested record matches the committed value. An absence proof must show that the full requested key hash is missing from the bucket. The bucket then replaces the leaf for the ordinary 64-step calculation. Empty and singleton commitments retain the old encoding.

Run `node tests/ibc-state-commitment/generate-collision-buckets.mjs --check` after building the transaction-builder runtime to check the shared Gateway, Go and Aiken collision vectors. Their peer key digests are explicitly synthetic. The requested key and all value, bucket and tree hashing use native SHA-256. The tests cover malformed buckets as well as insertion, replacement, deletion, occupied-position absence and collapse back to a singleton.

The existing adapter protobufs remain the wire contract. Run `node scripts/ci/generate-light-client-models.mjs` from the repository root after regenerating them. This generates the core data structs and explicit copying conversions. CI checks these outputs and limits handwritten adapter growth. New validation and transition rules belong in `state`, not in an adapter or the conversion generator.

Run `go test ./...` and `go vet ./...` in the core and both adapters. Core regressions cover native verification, immutable pages, receipt conflicts, expiry, recovery and session progress. Adapter tests cover actual IBC creation, signed admission and execution, proof paths, cleanup and authorized recovery. They reject every unsupported storage version. Full trusted checkpoint collections are preparation data only. They cannot be installed as public client or consensus records.

Pool identities, VRF bindings and registration ages come from the independent registry. Until Mithril certification, stake amounts remain unsigned claims. Forward updates cannot replace an installed table for the same epoch. Historical challenges may verify an alternative table for an epoch later than their trusted checkpoint. They cannot replace the table for that checkpoint epoch. A table disagreement alone cannot freeze the client. Only incompatible authenticated block histories establish misbehaviour. Native block verification alone does not authenticate the actual stake allocation.

A false table can omit a registered producer absent from its admission evidence and block later canonical progress. The supported fallback is an explicitly trusted substitute and authority recovery once the subject expires. Failed continuations and historical alternatives do not renew the committed checkpoint's lifetime. The bounded recovery sequence and its authority and timing assumptions are described in [the storage and verification design](../../docs/probabilistic-bounded-verification.md). Both SDK adapters test admission of the false table, the genuine omitted producer, same-ancestry disagreement, expiry and recovery on the original channel.

The repository builds against the local core through `replace` directives. Publish a core version before the adapter versions that require it. The v8 `v0.1.8` and v10 `v0.1.5` adapters require core `v0.1.6`.

Release tags for this nested module use the module directory prefix, for example:

```text
cosmos/cardano-probabilistic-light-client-core/v0.1.6
```

Hermes stages logical evidence from Gateway against pinned destination checkpoints. A completed observation produces an immutable receipt. Challenges submit two verified receipt references. They never reverify two full observations in one transaction. Snapshot-backed proofs reject discarded recovery generations immediately.

Staged activation emits `probabilistic_activation_result` with the session ID, sequence, receipt ID, anchor height and any published consensus height. Hermes binds this result to the submitted operation and the keeper's `update_client` event. Bootstrap steps, rootless activation, proposals, exact activation retries and Mithril certificate updates publish no consensus height. Their module events remain available without becoming synthetic consensus updates. The Hermes CI job runs signed v8 and v10 keeper transactions and passes their committed events through the production WebSocket collector before and after reconnecting.

The logical workload supports 4,000 stake rows, 128 headers and at most 97 full bodies. Each body is at most 96 KiB and each header-only witness is at most 1,100 bytes. Execution is split into bounded operations with a target of 900,000 signed bytes and 36 million gas per transaction. Public client records are at most 4 KiB and consensus records at most 1 KiB. Canonical stake segments prevent valid fragmentation from exhausting the session budget. Exact retries and rejected no-op transitions do not consume another submitter's progress.

A verified future table without Mithril certification starts a six-hour response window. A matching verified certificate received during that window ends the remaining stake wait at its transaction's host time. Activation and proofs still require a completed block after that cutoff. A contradicting certificate freezes the client. Host interruptions pause only unfinished uncertified stake windows. They do not restart elapsed challenge time or impose a new wait on certified or already cleared allocations. Bootstrap is Mithril-certified. Authorized recovery adopts an already usable substitute without starting a new stake window.

Native cryptography, qualification and nonce regressions also use an independent batch oracle in test code. It has no client update, initialization, storage or recovery implementation. Production authentication runs only through bounded observations.

Mithril certificate acceptance starts at `mithril.VerifyCertificate` through `VerifyCertificates`. The caller authenticates the epoch, aggregate key and protocol parameters against the saved anchor. It checks the protocol message hash and canonical lottery parameter before calling `crypto.StmAggrSig.Verify`. `crypto/wire.go` decodes the aggregate key and signature with strict JSON and validates compressed BLS points. `crypto/stm.go` checks index bounds, uniqueness, quorum and lottery wins. `crypto/merkle_tree.go` checks signer membership against the anchored root. `crypto/multi_sig.go` performs the BLS signature check. Its `Signature.Aggregate` remains in the verifier because verification itself combines signatures and keys. `crypto/helpers.go` supplies the lottery arithmetic and shared BLS point conversions. The shared `mithril/internal/merkleindex` package supplies tree index arithmetic.

The only non-test caller of certificate generation is `mithril/mithriltest.Network`, used by its local aggregator command. It imports `mithril/mithriltest/signing` for `StmInitializer`, `StmSigner`, `StmClerk`, local registration, secret-key operations and Merkle proof construction. The registration trusts locally generated keys and does not implement production signer admission. The core and both adapters' production packages cannot import this support. CI checks that boundary and `go list -deps` can inspect the resulting package graph. This source separation does not measure binary size.

Unused binary encodings for secret keys, initializers, protocol parameters, STM signatures, registered parties and Merkle paths were removed after checking their callers. The unused proof-of-possession helpers, standalone core-verifier setup and verification, single-path tree construction and comparison helpers were also removed. Certificate decoding continues to use the existing strict JSON layout. Compressed keys and signatures and the big-endian key-and-stake Merkle leaf encoding remain shared with generation. The signed message is `message || Merkle root`. The leaf count is used only for membership verification. The pinned `mithril-stm` reference aggregates check this rule directly and reject a BLS message that includes the leaf count.

The [native Injective replay](../../tests/injective-probabilistic-lifecycle/README.md) exercises the sole supported format against the pinned application and captured resource limits. Historical inline-format measurements remain as evidence for removing that implementation. They are not supported execution profiles.

Commitment values use the shared `commitmentcodec` package. It preserves the
historical eight-field Tendermint client format and the release's nine-field
format. The v8 and v10 adapters supply their protobuf fields and use the
same decoding and comparison rules. See the
[commitment codec specification](../../docs/cardano-commitment-codec.md) before
changing a wire type.
