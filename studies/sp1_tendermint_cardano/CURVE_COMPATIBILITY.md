# Proof-curve compatibility

Eureka's released update-client program can be reused, but its final Ethereum
proof cannot be submitted directly to Cardano.

SP1 6.1 names its final proof types `Groth16Bn254Proof` and
`PlonkBn254Proof`. Its gnark build compiles the final circuit over
`ecc.BN254.ScalarField()`. The official Eureka fixture in this study confirms
that boundary by verifying a real 356-byte SP1 Groth16 proof with
`sp1-verifier` 6.1.0.

Plutus V3 provides native pairing operations for BLS12-381, not BN254. The
included Aiken test therefore verifies a separate BLS12-381 Groth16 proof. It
does not verify the Eureka proof.

The implemented prototype adapter is one recursive outer proof. Off-chain, it
verifies the unchanged SP1 BN254 proof inside a BLS12-381 Groth16 circuit and
exposes the SP1 program key and public-values digest. gnark adds one commitment
and one commitment proof, so the Cardano proof bundle is 288 bytes rather than
a standard 192-byte Groth16 proof. The Aiken prototype verifies the complete
bundle at 62,385 memory units and 3,380,262,907 CPU units. This preserves the
Eureka guest and its normal SP1 proof as the inner proof, but adds a
curve-wrapping prover step, a BLS12-381 setup, and a new verification key that
must be pinned in the Cardano validator.

The relevant upstream sources are:

- https://github.com/cosmos/ibc-contracts/tree/main/ibc-solidity/programs/sp1-programs/update-client
- https://github.com/cosmos/ibc-contracts/tree/main/packages/tendermint-light-client/update-client
- https://github.com/succinctlabs/sp1/blob/v6.1.0/crates/recursion/gnark-ffi/go/sp1/build.go
- https://github.com/succinctlabs/sp1/blob/v6.1.0/crates/sdk/src/proof.rs
- https://github.com/cardano-foundation/bls/tree/24bd7e3a1f9f57b1d43b7bebdc37446dc559eb40/aiken/groth16

The accurate statement is “reuse Eureka's Tendermint guest and SP1 proving
stage, then add a Cardano-specific recursive wrapper.” Directly submitting
Eureka's Ethereum proof to Cardano remains impossible without BN254 Plutus
builtins.
