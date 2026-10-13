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

Update admission reserves capacity for two complete challenge headers. Gateway and both destination adapters cap each encoded header at 2.5 MiB. Gateway configuration can lower this limit but cannot raise it. Evidence also has at most 96 bridge blocks and 128 blocks in total. Full block witnesses are limited to 96 KiB and compact header witnesses to 1,100 bytes. Stake tables and registry snapshots contain at most 4,000 pools. The encoded client state cannot exceed 3 MiB. Evidence outside these bounds leaves synchronization pending.

Native verification consumes 200,000 gas per block on every verification pass. Each header verification must finish within 65 million metered gas. The challenge budget reserves two verifications plus transaction admission and the client read and freeze write. `capacity.go` defines these bounds together. Increasing a bound requires repeating the complete destination tests. The v8 admission handler calls `UpdateState` for custom misbehaviour messages. That call now leaves state unchanged so evidence reaches the keeper's verified freezing path.

The approved test scope is the repository's v8 and v10 local compatibility profiles. Hermes permits 8 MiB transactions. Its pinned version rejects the previous 12 MiB relayer setting. The nodes retain their 12 MiB transaction limit, 16 MiB block and gRPC receive limits and 20,000,000-byte RPC request limit. Both profiles allow 600 million transaction gas with Hermes's 1.8 gas multiplier. The Docker profiles use the adapter's Go toolchain, SDK patch version and Sonic dependency versions so their execution path matches the tests. These limits do not certify a public network.

`TestDestinationChallengeCapacity` starts a real CometBFT validator with the destination limits from `setup_profile.sh`. It submits signed updates through RPC and submits two-header challenges through the SDK gRPC service. It exercises simulation, the full ante handler, mempool admission, proposal handling and execution. Setting `CHALLENGE_RELAYER_PROBE` to the binary built from `tests/challenge-capacity-relayer` additionally runs Hermes's actual simulation, signing, batching and RPC broadcast code. CI requires that path. The test rejects oversized updates and altered signed evidence before checking that a valid challenge freezes the installed client.

The signed boundary fixtures include the earlier height-976 checkpoint, the count case stalled at height 966 and a smaller-body control. Each now has an independent conflicting history. A fourth fixture uses 96 bridge blocks, 31 descendants and a 4,000-pool registry. Each of its headers is 2,620,580 bytes, within 860 bytes of the admission ceiling. Its two-header challenge becomes a signed Hermes transaction of about 5.24 MB. Local runs used about 214 million gas on v8 and 238 million on v10. Both remain below 600 million after the 1.8 multiplier. Each test logs exact serialized sizes, executed gas and elapsed relay time and enforces the configured 10-second timeout.

These tests establish capacity for the enforced evidence envelope on the two local profiles. They use signed synthetic Praos blocks and do not establish full Cardano ledger validity. They do not prove that an arbitrary conflicting history outside the envelope has a smaller equivalent witness. Production approval still requires an approved destination's complete transport and execution measurements and an evidence-availability argument for its admitted update policy. A single-update benchmark or a larger local setting does not establish that guarantee.
