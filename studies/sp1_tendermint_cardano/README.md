# SP1 Tendermint client for Cardano

## Why this exists

The direct Aiken ICS-07 client puts Tendermint validator sets and signatures in
the Cardano transaction and verifies them on-chain. An Injective update with 45
validators already exceeds Cardano's transaction size and execution limits.
Larger validator sets make both problems worse.

This implementation moves the same ICS-07 verification into the SP1 programs
released for IBC Eureka. Cardano receives a fixed-size proof of the result:

```text
ICS-07 header or misbehaviour
  -> released Eureka SP1 program
  -> SP1 BN254 proof
  -> generic BLS12-381 wrapper
  -> 288-byte proof checked by Aiken
```

The proof size and Aiken proof-verification cost do not grow with the validator
set. SP1 proving time still does.

## How it is integrated

Hermes continues to submit the standard Tendermint `Header` or `Misbehaviour`
message to the Gateway. When `TENDERMINT_UPDATE_CLIENT_MODE=sp1`, the Gateway
sends the message and the required trusted state to the internal prover
service. The service runs the released Eureka program, verifies its result
locally, wraps the SP1 proof, and returns the Cardano proof and public output.

The Gateway then refetches the client UTxO, rejects a stale result, rebuilds the
transaction against current HostState, and submits a proof-bearing client
update. The existing direct verification path remains available through
configuration.

The Cardano transaction invokes three scripts. HostState applies the existing
IBC state commitment update. The client validator checks the required state
transition. A zero withdrawal invokes the Tendermint proof validator, which
pins the expected update or misbehaviour program key and the wrapper
verification key, verifies the 288-byte proof, decodes the public output, and
binds it to the consumed and produced client state.

Normal updates append the proved consensus state and height. Two-header
misbehaviour checks both stored trusted states and freezes the client without
changing other client fields. The update guest fixes maximum clock drift at 15
seconds. Eureka intentionally omits the future-header check for fork/lunatic
attack evidence. Cardano separately rechecks client activity and trusted-state
expiry against the transaction time.

Deployment publishes the proof validator as a reference script, registers its
stake credential, includes it in the bridge manifest, and parameterizes the
client validator with its script hash. The deployment uses the
`verification_key.json` produced by that deployment's wrapper setup and records
its SHA-256 and the setup manifest in `handler.json`.

## What was reused and what changed

The update and misbehaviour guest programs are the unmodified binaries from
the `sp1-programs-v2.0.0` IBC Eureka release. They are not specific to
Injective; the same Tendermint program handles any compatible Cosmos chain.

Eureka's Ethereum verifier cannot be copied to Cardano because SP1 emits a
BN254 proof and Plutus exposes BLS12-381 pairing operations. The generic Go
wrapper verifies the BN254 proof and produces the BLS12-381 proof checked by
Aiken. The Gateway orchestration, Cardano transaction encoding, proof
withdrawal script, client-state binding, deployment changes, and replay storage
are Cardano-specific.

No Cosmos Go light-client module or Hermes change is required.

## Measurements and limits

The released update program executed a real 45-validator Injective adjacent
update in 2,796,372 SP1 instructions. Local CPU proof generation took 590.383
seconds and reached 8.99 GB resident memory. Loading the persisted wrapper
setup took 136.207 seconds and wrapping took 18.891 seconds.

A generated 200-validator adjacent update executed successfully in 17,222,743
SP1 instructions and was mock-proved. A production proof for that case has not
been generated or timed. The measured Cardano proof remains 288 bytes in both
the transaction encoding and the Aiken tests.

The released misbehaviour program also proved deterministic two-validator
double-sign evidence. The optimized end-to-end run took 765.06 seconds and
reached 8.21 GB resident memory: about 623 seconds before the outer wrapper and
142 seconds in the wrapper. Its 288-byte proof uses the same persisted outer
verification key as the update proof.

This removes validator count from the Cardano transaction payload, but it does
not remove every capacity limit. Client consensus-state history still affects
the HostState and client transition. Proof-based clients therefore retain at
most 10 consensus states. The Gateway rejects proof updates when the input
already exceeds that limit, the on-chain validator enforces the same limit, and
CI measures the complete transition at 10 states. Existing direct-mode clients
with more than 10 states cannot switch to proof mode without a separate state
migration. The direct path keeps its existing 300-state limit.

The prover is not trusted for safety because an invalid proof is rejected
on-chain. It is a liveness and operations dependency. The current compose
service is restricted to the internal bridge network and allows one proof at a
time. A public deployment would need authentication, rate limits, monitoring,
resource isolation, and proof job management.

The persisted Groth16 setup used here is a single-process development setup,
not a production ceremony. Provision it once before deployment and before
starting the compose profile:

```sh
(cd cardano/sp1-tendermint-prover/bn254-to-bls-wrapper && \
  go run . \
    -fixture ../../../studies/sp1_tendermint_cardano/fixtures/update_client_fixture-groth16.json \
    -setup-keys -prove \
    -key-dir ../keys-local \
    -out ../keys-local)
```

This writes `outer.r1cs`, `outer.pk`, `outer.vk`, `manifest.json`, and
`verification_key.json` into the ignored `keys-local` directory. The offchain
deployment reads that verification key, and compose mounts the same directory
read-only. The runtime verifies every raw setup file against `manifest.json`
and never generates or changes keys. If the directory is lost, a new setup
produces a different verification key and requires a new Cardano deployment.

## Verification

The normal tests do not generate a new SP1 production proof. They verify the
checked-in released-key regression proofs, rejection cases, encoders, Gateway
orchestration, Aiken state transitions, and transaction budgets.

```sh
cargo test --manifest-path cardano/sp1-tendermint-prover/Cargo.toml --locked
(cd cardano/sp1-tendermint-prover/bn254-to-bls-wrapper && go test ./...)
(cd cardano/onchain && aiken check --deny --plain-numbers)
(cd cardano/gateway && npm test)
(cd cardano/offchain && deno test -A)
```

The production service and wrapper live in `cardano/sp1-tendermint-prover`.
The prover image is built from the repository root and copies both released
Eureka binaries from `third_party/ibc-eureka/sp1-programs-v2.0.0` after checking
their pinned SHA-256 values. It does not require the upstream repository during
the build or at runtime. The image does not contain a wrapper proving or
verification key. The compose `sp1` profile mounts the deployment-specific
setup read-only. Main-branch builds publish the image to GHCR; production
deployments set `SP1_TENDERMINT_PROVER_IMAGE` to the published digest.

## Provenance

The guests come from the [`sp1-programs-v2.0.0`
release](https://github.com/cosmos/ibc-contracts/releases/tag/sp1-programs-v2.0.0),
commit `ef25a661a8be156d4908956e1055ca40cd67adb7`, using SP1 6.1.0. Binary,
fixture, key, and public-output hashes are recorded in `provenance.json` and the
artifact metadata. The Aiken Groth16 verifier is derived from
[`cardano-foundation/bls`](https://github.com/cardano-foundation/bls/tree/24bd7e3a1f9f57b1d43b7bebdc37446dc559eb40/aiken/groth16).
