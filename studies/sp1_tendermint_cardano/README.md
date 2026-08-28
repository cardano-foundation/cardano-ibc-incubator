# SP1 Tendermint verifier prototype

## Result

This study tests whether Cardano can replace direct Tendermint validator-set
and signature verification with the SP1 ICS-07 program used by IBC Eureka.
It is isolated from the production validators and Gateway.

The same Eureka program handled both a real 45-validator Injective update and
a valid generated 200-validator adjacent update without chain-specific code. The
Ethereum proof cannot be submitted directly to Cardano, however, because SP1
6.1 produces a BN254 proof while Plutus provides native pairing operations for
BLS12-381. The prototype solves that mismatch with one generic recursive
wrapper:

```text
ICS-07 header -> Eureka SP1 program -> BN254 proof
             -> BLS12-381 wrapper -> Aiken verifier
```

The wrapper verifies the unchanged Eureka proof and produces a 288-byte proof.
The isolated Aiken verifier accepts it below Cardano's current per-transaction
limits. This establishes technical feasibility; it is not a complete Cardano
transaction or production light-client integration.

## Measurements

The released Eureka guest produced the following results:

| Case | Validators | SP1 instructions | Syscalls | Public output |
| --- | ---: | ---: | ---: | ---: |
| Injective | 45 | 2,796,372 | 12,585 | 768 bytes |
| Generated adjacent update | 200 | 17,222,743 | 107,412 | 768 bytes |

The 200-validator case was directly executed and mock-proved. A production SP1
proof for that case has not yet been generated or timed.

The recursive-wrapper measurement used the official Eureka Groth16 fixture:

| Measurement | Result |
| --- | ---: |
| Wrapper proof generation | 8.864 seconds |
| Cardano proof bundle | 288 bytes |
| Aiken verification | 62,385 memory / 3,380,262,907 CPU |

The wrapper time excludes inner SP1 proving. Its one-time development setup
took 214.810 seconds and was an insecure single-process setup without a
production ceremony. The 288-byte bundle contains the Groth16 proof, one gnark
commitment, and its proof of knowledge. Proof size and Aiken verification cost
do not depend on validator count, although SP1 proving work does. Tampered proof
data is rejected.

## What the proof establishes

The SP1 program verifies the expensive ICS-07 work: Tendermint header and
validator-set hashes, canonical vote bytes, Ed25519 signatures, voting-power
thresholds, trusted overlap for skipped-height updates, and time rules.

The wrapper fixes the SP1 Groth16 verification key and recursion key root,
requires a successful SP1 exit, and exposes the update-client program key plus
masked SHA-256 of the exact 768-byte `UpdateClientOutput`. The Aiken
validator must pin the expected keys, recompute that digest, decode the output,
and bind its trusted and new heights and consensus states to the consumed and
produced client state, transaction validity interval, processed consensus
metadata, and corresponding HostState update.

Eureka fixes maximum clock drift at 15 seconds inside this guest. A production
Cardano validator must additionally apply the configured Cardano client clock
drift to the proved timestamp. Misbehaviour requires a separate proved
statement that binds both headers and the frozen client output. Membership and
combined update-plus-membership also require separate programs and statements;
they were not tested here.

## Proposed integration

Hermes can continue to submit standard ICS-07 headers. The Gateway, or a prover
service called by it, would run Eureka's existing SP1 prover and the generic
curve wrapper, then build a proof-bearing Cardano transaction. The prover is
not trusted for safety because invalid proofs fail on-chain, but it is a
liveness dependency.

The Aiken client validator would perform proof verification, Cardano state
binding, and the existing state transition. Cosmos Go light-client modules do
not change. The new Aiken script would require a new Cardano deployment.

## Repository layout

| Path | Purpose |
| --- | --- |
| `eureka-guest-runner` | Runs the released Eureka program with 45 and 200 validators. |
| `eureka-proof-check` | Verifies the official SP1 BN254 fixture and rejection cases. |
| `bn254-to-bls-wrapper` | Builds and tests the recursive curve wrapper. |
| `cardano-verifier` | Verifies the exact wrapped proof in Aiken. |
| `fixtures` | Contains the pinned upstream Eureka proof fixture. |
| `provenance.json` | Records upstream revisions and artifact hashes. |

Run the focused checks with:

```sh
cd studies/sp1_tendermint_cardano/eureka-guest-runner
./run.sh

cd ../eureka-proof-check
cargo test --locked
cargo run --locked --quiet

cd ../bn254-to-bls-wrapper
go test ./...
go run .

cd ../cardano-verifier
aiken check --deny --plain-numbers
```

Generate a new development wrapper proof with
`go run . -prove -out artifacts-local`; do not overwrite the checked-in test
artifacts.

## Remaining work

Production use requires a real 200-validator SP1 proof and timing result,
Gateway/prover orchestration, exact Cardano statement encoding, misbehaviour
support, whole-transaction budget tests, production verification keys and
setup, and independent review of the wrapper circuit and Aiken verifier.

## Upstream sources

The guest is from [`cosmos/ibc-contracts` release
`sp1-programs-v2.0.0`](https://github.com/cosmos/ibc-contracts/releases/tag/sp1-programs-v2.0.0),
commit `ef25a661a8be156d4908956e1055ca40cd67adb7`, using SP1 6.1.0. The
downloaded ELF is checksum-pinned in `provenance.json`.

The proof fixture is copied from `cosmos/ibc-contracts` commit
`60f6575adf0b3202c86940a80a9e2230b3bd6107` and retains its Apache-2.0
license. The Aiken Groth16 verifier is derived from
[`cardano-foundation/bls`](https://github.com/cardano-foundation/bls/tree/24bd7e3a1f9f57b1d43b7bebdc37446dc559eb40/aiken/groth16).
