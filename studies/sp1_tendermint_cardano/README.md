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
set. SP1 guest and prover work still grow; full proving-time scaling has not
been measured.

## How it is integrated

Hermes continues to submit the standard Tendermint `Header` or `Misbehaviour`
message to the Gateway. Each deployment declares either
`07-tendermint-sp1` or `07-tendermint-direct` and binds that protocol to its
spend-client script hash. The Gateway checks the client UTxO against that hash.
For an SP1 client, it sends the message and required trusted state to the
internal prover service. The service runs the released Eureka program, verifies
its result locally, wraps the SP1 proof, and returns the Cardano proof and
public output.

The Gateway then refetches the client UTxO, rejects a stale result, rebuilds the
transaction against current HostState, and submits a proof-bearing client
update. New deployments use the proof-only SP1 validator. Native Aiken
verification remains a separate legacy deployment for existing direct clients;
it is not another branch in the new validator.

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
stake credential, identifies the deployment as `07-tendermint-sp1` in the
bridge manifest, and parameterizes the proof-only client validator with the
proof-validator script hash. The deployment uses the
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
setup took 136.207 seconds and wrapping took 18.891 seconds. These are one
local development observation; hardware details and repeated-run statistics
were not recorded.

The service now keeps the wrapper process and its 505 MB proving key loaded.
In one fresh two-request process on the Apple M5 host described below, startup
to readiness took 134.319 seconds, then the two wraps took 9.775701833 and
9.61133575 seconds. Total process wall time was 159.22 seconds and peak resident
memory was recorded as approximately 4.23 GB. The run used Go 1.26.1,
gnark 0.14.0, and gnark-crypto 0.19.2. This is one observation, not a latency or
memory distribution. The startup cost is paid once per process, not once per
header. This makes wrapping a small part of warm-request latency; it does not
reduce the much larger SP1 proof-construction time.

Reproduce the two-request wrapper run with
`cardano/sp1-tendermint-prover/bn254-to-bls-wrapper/benchmark-worker.sh`.

A second runner-only measurement used a 16 GB Apple M5 with four performance
cores, six efficiency cores, macOS 26.4, and Rust 1.91.1. The retained full
Groth16 observation came from the pre-alignment prototype runner at commit
`54b5776a8a6a805d5d695801089dd6897174825a`, not the currently attested runner.
That proof call took 505.846 seconds and the complete process took 526.69
seconds. Its input predates the current millisecond alignment, so its proof
timestamp and public-values hash intentionally differ from the current runner
observations. The following screening runs use cumulative proof modes:
`Core` stops before recursive reduction, while `Compressed` includes Core and
recursive reduction but stops before shrink, wrap, and the final Groth16 proof.
Each row is one verified run of the same Injective fixture, not a statistical
sample.

| Configuration | Mode | Proof call | Maximum resident memory |
| --- | --- | ---: | ---: |
| SP1 defaults, 10 Rayon threads | Core | 58.150 s | 6.78 GB |
| 16,777,216-entry trace chunks, 10 threads | Core | 56.035 s | 7.89 GB |
| SP1 defaults, 10 threads | Compressed | 113.332 s | 9.28 GB |
| 16,777,216-entry trace chunks, 10 threads | Compressed | 118.474 s | 8.31 GB |
| SP1 defaults, 8 threads | Compressed | 128.726 s | 7.42 GB |
| Reduced recursion workers, 10 threads | Compressed | 119.914 s | 8.00 GB |
| Apple-native build with thin LTO, 10 threads | Compressed | 123.536 s | 7.72 GB |

The smaller trace chunks reduced Compressed resident memory by about 10%, but
made the proof about 4.5% slower. Eight threads, reduced recursion concurrency,
and the native/LTO build were also slower. SP1's fixed proving-key option was
not usable: SP1 6.1 reached an unimplemented executor reset and then failed
with `artifact not found`. The best Compressed result alone is 113.332 seconds,
before the remaining Groth16 stages, so these local settings cannot reduce the
current CPU proof below 60 seconds. Reaching that target requires a material
prover improvement, an SP1 upgrade with compatible circuit and wrapper keys,
or faster CPU hardware; it is not a matter of enabling more local threads.

The execution cost can be measured without generating a proof or using network
credits:

```sh
studies/sp1_tendermint_cardano/eureka-guest-runner/benchmark-cpu.sh \
  baseline execution all
```

A single Apple M5 run measured 0.907 seconds, 12,585 syscalls, and an estimated
3,140,508 PGU for 45 validators. The 200-validator case measured 9.682 seconds,
107,412 syscalls, and an estimated 19,714,926 PGU. These are local guest
execution measurements, not proof-generation time or network billing. The
generated JSON leaves network latency and actual network PGU fields null.

The CPU proof profiles can be rerun separately:

```sh
studies/sp1_tendermint_cardano/eureka-guest-runner/benchmark-cpu.sh \
  baseline compressed injective-45
```

The available profiles are `baseline`, `trace-16m`, `threads-8`,
`recursion-low`, and `native`; the modes are `execution`, `core`, `compressed`,
and `groth16`. Every run writes a timestamped directory with its context, log,
and metrics. CPU proofs remain a manual benchmark and are not run in CI.

The production service selects `cpu` or `network` with
`SP1_TENDERMINT_PROVER_BACKEND`. CPU is the default and does not make an
external request. Network mode uses the same SP1 6.1 program and proof format,
applies explicit proof, auction, gas, cycle, and price limits, and still
verifies the returned proof locally before wrapping it. No paid network proof
has been submitted from this branch, so it contains no measured network proof
latency. Network mode is still experimental: SP1's transport can retry an
ambiguous submission, and this service does not yet persist the mapping from a
Gateway request ID to a Succinct request ID across restarts. Retrying after an
ambiguous failure can therefore pay for a duplicate proof. Within one service
process, retries reuse the known Succinct request ID and fetch the proof again
before local verification. A terminal network job remains attached to that
Gateway request ID until an operator restarts the service; the service does not
silently submit a replacement paid job.

A generated 200-validator adjacent update executed successfully in 17,222,743
SP1 instructions and was mock-proved. A full SP1 Groth16 proof was not generated
or timed. The tracked 45-validator wrapped proof is 288 bytes in both the
transaction encoding and the Aiken tests. The wrapper format fixes that length,
but no wrapped proof was generated for the 200-validator case.

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
CI exercises the isolated transition contexts at the 10-state boundary. A
completed, provider-evaluated 10-state transaction still needs to be measured.
A direct client cannot switch protocols in place because its UTxO is locked by
the legacy validator. The legacy direct protocol keeps its existing 300-state
limit.

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

The normal tests do not generate a fresh SP1 Groth16 proof. They verify the
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
