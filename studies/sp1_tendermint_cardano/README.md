# SP1 Tendermint proof on Cardano

This study tests whether Cardano can replace direct Tendermint signature and
validator-set verification with the SP1 ICS-07 program used by IBC Eureka.
It is isolated from the production validators and Gateway.

The Tendermint part can be reused. Eureka's released SP1 update-client program
accepts the real 45-validator Injective fixture and a valid generated
200-validator adjacent update without any chain-specific code. The 200-validator
case executes 17,222,743 SP1 instructions. The official Eureka Groth16 fixture
also verifies locally, and its complete Ethereum update message is 1,376 bytes.

The final Ethereum proof cannot be verified unchanged on Cardano. SP1 6.1 wraps
the computation in a BN254 Groth16 or Plonk proof, while Plutus exposes native
BLS12-381 pairing operations. The prototype therefore adds a generic recursive
wrapper. It verifies the unchanged Eureka BN254 proof inside a BLS12-381
Groth16 circuit and exposes the SP1 program key and authenticated public-output
digest.

That complete curve bridge works. The outer circuit has 1,192,065 constraints,
produces a 288-byte proof bundle, and generated the outer proof in 8.864 seconds
after a 214.810-second development setup. The Aiken verifier accepts that exact
proof at 62,385 memory units and 3,380,262,907 CPU units, below Cardano's current
16.5-million-memory and 10-billion-CPU per-transaction limits. It rejects
changed Eureka public values and a changed commitment proof.

The 8.864-second measurement is only the recursive wrapper step. It excludes
generation of the inner SP1 proof.

The recursive proof wraps an official Eureka proof for the same released
update-client program. The 200-validator case has only been run through direct
SP1 execution and mock proving; generating and timing its production SP1 proof
is still required. SP1 proof size and Aiken verification cost do not depend on
the Tendermint validator count.

## Contents

`eureka-guest-runner` executes the released Eureka program against the 45- and
200-validator cases. `eureka-proof-check` verifies the official Ethereum
Groth16 fixture with `sp1-verifier` 6.1.0 and rejects changed proof/public-value
bytes. `cardano-verifier` contains the isolated Aiken verifier for the complete
gnark proof, including its commitment proof.
`bn254-to-bls-wrapper` contains the recursive-wrapper experiment.

The runner downloads Eureka's released ELF rather than copying or modifying
the guest. A production host can continue to use Eureka's
`sp1-ics07-tendermint-prover` package or the Succinct proving network, then pass
the resulting proof through the Cardano wrapper.

The exact upstream revisions and artifact checksum are recorded in
`provenance.json`. `CURVE_COMPATIBILITY.md` explains the curve mismatch, and
`CARDANO_BINDING.md` defines which Cardano state must be bound to a proof.

## Checks

```sh
cd studies/sp1_tendermint_cardano/eureka-proof-check
cargo test --locked
cargo run --locked --quiet

cd ../cardano-verifier
aiken check -m 'groth16/gnark_wrapper.{..}' --plain-numbers
```

The guest runner and recursive-wrapper directories contain their own commands
and prerequisites.

## Production boundary

A production implementation would keep standard ICS-07 headers at the relayer
boundary. The Gateway, or a prover service called by it, would produce the SP1
proof and the BLS12-381 wrapper proof. Hermes and the Cosmos Go light-client
modules would not verify a new algorithm. The Aiken client validator would pin
the wrapper verification key, verify the proof, bind its public statement to
the consumed client/consensus state and transaction interval, then perform the
existing client and HostState transition.

This would change the Cardano validator hash and require a new deployment. The
prover is untrusted for safety because invalid proofs fail on-chain, but it is a
liveness dependency. Production use also requires a reviewed statement codec,
a production setup ceremony, versioned verification keys, an independent
circuit review, misbehaviour support, a real 200-validator production proof,
and complete Gateway transaction benchmarks.
