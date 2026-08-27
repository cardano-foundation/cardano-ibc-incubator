# BN254-to-BLS12-381 recursive wrapper study

This isolated study tests whether the existing IBC Eureka SP1 v6.1 Groth16
proof can remain unchanged as an off-chain inner proof and be wrapped in a
BLS12-381 Groth16 proof that Cardano Plutus V3 can verify.

The outer gnark circuit fixes SP1 v6.1's BN254 Groth16 verification key,
verifies the Eureka proof with gnark's non-native BN254 verifier, exposes the
SP1 program key and masked SHA-256 public-values digest, requires `exitCode ==
0`, and fixes the SP1 recursion verification-key root. The proof nonce remains
private. This is a development feasibility test, not production cryptography;
`-prove` uses gnark's single-process insecure Groth16 setup.

Run the native inner-proof check and compile the outer circuit:

```sh
go run .
```

Run development setup, proof generation, and verification, optionally writing
the proof, verification key, public inputs, and exact Eureka public values:

```sh
go run . -prove -out artifacts-local
```

The real Eureka fixture produced a circuit with 1,192,065 constraints, two
public inputs, 60 secret variables, 1,899,857 internal variables, and one gnark
BSB22 commitment. The final custom-transcript run took 214.810 seconds for
setup, 8.864 seconds for proof generation, and 0.003 seconds for native proof
verification. Its peak resident memory was 4,180,934,656 bytes. These are
single development-machine measurements, not performance targets.

The proof is 288 bytes of compressed BLS12-381 points: Groth16 A (48), B (96),
C (48), one BSB22 commitment (48), and its proof of knowledge (48). It is not a
standard three-point Groth16 proof. A Cardano verifier must add the commitment
to the Groth16 input accumulator and verify the commitment proof with the two
Pedersen G2 points in the verification key.

For the commitment wire, prover and verifier use masked SHA-256 over
`cardano-ibc:gnark-bsb22:v1:` followed by the canonical 48-byte compressed
commitment and any fixed-width committed public fields. The fixture has no
committed public fields. Clearing the digest's top three bits makes the result
a canonical BLS12-381 scalar. This custom transcript lets Plutus reproduce the
input with `bls12_381_G1_compress` and `sha2_256`.

The checked-in `artifacts` directory is the exact fixture consumed by the
Aiken test. A local regeneration uses fresh setup randomness and should be
written to `artifacts-local` rather than overwriting that fixture.

The generated verification key is valid only for the corresponding development
setup. A production deployment requires a reviewed circuit and a production
setup ceremony; regenerating setup creates a different verification key and
invalidates existing outer proofs.

The embedded 492-byte verification key is copied from
`sp1-verifier=6.1.0/vk-artifacts/groth16_vk.bin` and has SHA-256
`4388a21c687fdd5f218d7e3d13190cac4c5355818d3605fd5fb811df468ee696`.
