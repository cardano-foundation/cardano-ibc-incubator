// BLS12-381 Groth16 verifier for the Cardano wrapper around an SP1 BN254
// proof. gnark adds one BSB22 commitment for the emulated BN254 arithmetic,
// so both the Groth16 equation and the commitment proof are checked here.

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_neg,
  bls12_381_g1_uncompress, bls12_381_g2_uncompress, bls12_381_miller_loop,
  bls12_381_mul_miller_loop_result, sha2_256,
}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/scalar
use aiken/primitive/bytearray

pub type Proof {
  a: ByteArray,
  b: ByteArray,
  c: ByteArray,
  commitment: ByteArray,
  commitment_pok: ByteArray,
}

pub type CommitmentKey {
  g: ByteArray,
  g_sigma_neg: ByteArray,
}

pub type VerificationKey {
  alpha_g1: ByteArray,
  beta_g2: ByteArray,
  gamma_g2: ByteArray,
  delta_g2: ByteArray,
  // K[0], K[program vkey], K[public-values digest], K[commitment hash].
  ic: List<ByteArray>,
  commitment_key: CommitmentKey,
}

const commitment_hash_domain =
  #"63617264616e6f2d6962633a676e61726b2d62736232323a76313a"

const two_to_253 =
  14474011154664524427946373126085988481658748083205070504932198000989141204992

/// Verify the Cardano wrapper proof. `public_inputs` must be exactly
/// `[1, sp1_program_vkey, masked_sha256(eureka_public_values)]`.
pub fn verify(
  proof: Proof,
  public_inputs: List<Int>,
  vk: VerificationKey,
) -> Bool {
  when (public_inputs, vk.ic) is {
    (
      [1, program_vkey, public_values_digest],
      [ic0, ic_program, ic_digest, ic_commitment],
    ) -> {
      let a = bls12_381_g1_uncompress(proof.a)
      let b = bls12_381_g2_uncompress(proof.b)
      let c = bls12_381_g1_uncompress(proof.c)
      let commitment = bls12_381_g1_uncompress(proof.commitment)

      let v =
        bls12_381_g1_uncompress(ic0)
          |> bls12_381_g1_add(
              g1.scale(
                bls12_381_g1_uncompress(ic_program),
                scalar.from_int(program_vkey),
              ),
            )
          |> bls12_381_g1_add(
              g1.scale(
                bls12_381_g1_uncompress(ic_digest),
                scalar.from_int(public_values_digest),
              ),
            )
          |> bls12_381_g1_add(
              g1.scale(
                bls12_381_g1_uncompress(ic_commitment),
                scalar.from_int(commitment_hash(proof.commitment)),
              ),
            )
          |> bls12_381_g1_add(commitment)

      let lhs = bls12_381_miller_loop(a, b)
      let rhs =
        bls12_381_miller_loop(
          bls12_381_g1_uncompress(vk.alpha_g1),
          bls12_381_g2_uncompress(vk.beta_g2),
        )
      let rhs =
        bls12_381_mul_miller_loop_result(
          rhs,
          bls12_381_miller_loop(c, bls12_381_g2_uncompress(vk.delta_g2)),
        )
      let rhs =
        bls12_381_mul_miller_loop_result(
          rhs,
          bls12_381_miller_loop(v, bls12_381_g2_uncompress(vk.gamma_g2)),
        )

      bls12_381_final_verify(lhs, rhs) && verify_commitment_knowledge(
        commitment,
        bls12_381_g1_uncompress(proof.commitment_pok),
        vk.commitment_key,
      )
    }
    _ -> False
  }
}

/// Reproduce the custom gnark Fiat-Shamir scalar. The wrapper hashes the
/// domain and canonical compressed commitment, then clears the top three bits.
pub fn commitment_hash(commitment: ByteArray) -> Int {
  masked_sha256(bytearray.concat(commitment_hash_domain, commitment))
}

/// Build the three public scalars authenticated by the wrapper proof.
pub fn sp1_public_inputs(
  program_vkey: ByteArray,
  public_values: ByteArray,
) -> List<Int> {
  [1, bytearray.to_int_big_endian(program_vkey), masked_sha256(public_values)]
}

/// Match SP1's SHA-256-to-field encoding by clearing the digest's top three
/// bits. Taking the value modulo 2^253 is equivalent to that mask.
pub fn masked_sha256(bytes: ByteArray) -> Int {
  bytes
    |> sha2_256()
    |> bytearray.to_int_big_endian()
    |> fn(n) { n % two_to_253 }
}

fn verify_commitment_knowledge(
  commitment: G1Element,
  pok: G1Element,
  key: CommitmentKey,
) -> Bool {
  // gnark checks e(commitment, G^-sigma) * e(pok, G) == 1.
  bls12_381_final_verify(
    bls12_381_miller_loop(commitment, bls12_381_g2_uncompress(key.g_sigma_neg)),
    bls12_381_miller_loop(bls12_381_g1_neg(pok), bls12_381_g2_uncompress(key.g)),
  )
}
