# Cardano Probabilistic Light Client Core

This module contains shared Cardano/probabilistic verification logic used by the `ibc-go` versioned adapters:

```text
cosmos/cardano-probabilistic-light-client-v8
cosmos/cardano-probabilistic-light-client-v10
```

The `state` package owns header authentication, scoring, checkpoint and epoch transitions, time checks, misbehaviour, recovery, and consensus metadata. Fix these rules here once for both adapters. The root package owns Cardano block decoding, native verification, HostState extraction, and commitment proof calculation.

The core does not import `ibc-go` or `cosmos-sdk` or register protobuf types. The state machine uses the common `cosmossdk.io/store` interface. Adapters supply a small context value and a `StateCodec` that reads and writes each version's registered protobuf `Any` values. They also translate IBC paths, proof values, error codes, and module APIs.

The existing adapter protobufs remain the wire contract. Run `node scripts/ci/generate-light-client-models.mjs` from the repository root after regenerating them. This generates the core data structs and explicit copying conversions. CI checks these outputs and limits handwritten adapter growth. New validation and transition rules belong in `state`, not in an adapter or the conversion generator.

Run `go test ./...` and `go vet ./...` in the core and both adapter modules. State-machine regressions live in `state`. Each adapter tests its protobuf conversions, IBC error identity, and stored bytes. `testdata/state_machine_store.json` was captured from the v8 implementation on main at `96ace927` for initialization, freezing, and recovery. The fixture now includes nonce and pool registration checkpoints and settlement credit references. Both adapters must reproduce those bytes, including the host revision in processed metadata. Clients without the required running state need an explicitly trusted new starting checkpoint.

Pool identities, VRF bindings and registration ages come from the independent registry described in [POOL_REGISTRY.md](POOL_REGISTRY.md). That document also specifies the required bootstrap file and the remaining ledger-validity assumption. Stake amounts still use the challenge model.

The repository builds against the local core through `replace` directives. Before publishing new adapter versions, publish a core version containing `state` and update both adapters to require that version. The existing `v0.1.5` release does not contain the new package.

Release tags for this nested module use the module directory prefix, for example:

```text
cosmos/cardano-probabilistic-light-client-core/v0.1.5
```
