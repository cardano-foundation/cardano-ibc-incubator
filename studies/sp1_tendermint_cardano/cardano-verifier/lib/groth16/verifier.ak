// Derived from cardano-foundation/bls commit
// 24bd7e3a1f9f57b1d43b7bebdc37446dc559eb40 (Apache-2.0).
// Reduced to the verifier core and focused tests for this prototype.

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_uncompress,
  bls12_381_g2_uncompress, bls12_381_miller_loop,
  bls12_381_mul_miller_loop_result,
}
use aiken/crypto/bls12_381/g1 as g1
use aiken/crypto/bls12_381/scalar as scalar

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Groth16 proof consisting of three compressed curve points.
pub type Proof {
  a: ByteArray,
  b: ByteArray,
  c: ByteArray,
}

/// Groth16 verification key — everything needed to verify a proof.
///
/// * `alpha_g1` — 48-byte compressed G1 point (`alpha * G1`).
/// * `beta_g2`  — 96-byte compressed G2 point (`beta * G2`).
/// * `gamma_g2` — 96-byte compressed G2 point (`gamma * G2`).
/// * `delta_g2` — 96-byte compressed G2 point (`delta * G2`).
/// * `ic`       — list of 48-byte compressed G1 points. `ic[i] = Psi_V_G1[i]`.
///                  Only the first `n_public` entries are used for `V`.
/// * `n_public` — number of public variables (including the constant wire).
pub type VerificationKey {
  alpha_g1: ByteArray,
  beta_g2: ByteArray,
  gamma_g2: ByteArray,
  delta_g2: ByteArray,
  ic: List<ByteArray>,
  n_public: Int,
}

// ---------------------------------------------------------------------------
// Hard-coded verification key (compressed BLS12-381 points)
// ---------------------------------------------------------------------------

/// alpha * G1  (scalar = 5)
const alpha_g1 =
  #"b0e7791fb972fe014159aa33a98622da3cdc98ff707965e536d8636b5fcc5ac7a91a8c46e59a00dca575af0f18fb13dc"

/// beta * G2  (scalar = 7)
const beta_g2 =
  #"8d0273f6bf31ed37c3b8d68083ec3d8e20b5f2cc170fa24b9b5be35b34ed013f9a921f1cad1644d4bdb14674247234c8049cd1dbb2d2c3581e54c088135fef36505a6823d61b859437bfc79b617030dc8b40e32bad1fa85b9c0f368af6d38d3c"

/// gamma * G2  (scalar = 11)
const gamma_g2 =
  #"a190be857d602284393305bfe0a29e29a6982ed3f04ccaabafb7e59cdc7eda85c22bc3e8690355c7a0fb7590ae40f1b009303f04d568e289a35102b6df883d5ed620355c0eb5d02236718cdaf99fba6e19ef5cee2996268eb9a53ae1ee09bce3"

/// delta * G2  (scalar = 13)
const delta_g2 =
  #"8bf78a97086750eb166986ed8e428ca1d23ae3bbf8b2ee67451d7dd84445311e8bc8ab558b0bc008199f577195fc39b7152110e866f1a6e8c5348f6e005dbd93de671b7d0fbfa04d6614bcdd27a3cb2a70f0deacb3608ba95226268481a0be7c"

/// Psi_V_G1[1] = (w_1(tau) * alpha + u_1(tau) * beta + w_1(tau)) / gamma * G1
/// For our circuit, variable 1 is the public output `a`. Scalar = 3/gamma.
const psi_v_g1_1 =
  #"a087561bc7f3b2650328084de8424253a1846fe77fb0f498a3fade9d70b556016d1de5d0490fa64a444a1f53cc13d70d"

// ---------------------------------------------------------------------------
// Hard-coded proof for the concrete witness [1, 48, 2, 2, 3, 4, 4, 12]
// ---------------------------------------------------------------------------

/// A = (l(tau)+alpha) * G1  (combined scalar = 10)
const proof_a =
  #"af81da25ecf1c84b577fefbedd61077a81dc43b00304015b2b596ab67f00e41c86bb00ebd0f90d4b125eb0539891aeed"

/// B = (r(tau)+beta) * G2  (combined scalar = 33)
const proof_b =
  #"ab0f336a9b3ee493b210f64587b8c1d5fab0a86346812545a822692c40ee4eecb349a69388ba3ad13ea3c5f8d29eb36506547761152a1517a6fffeefff70c7e817bdcf94dfa8e25955a0b4ac6ffcfd9477d7230902453d78bac3bcd06dbbb457"

/// C = (sum_private + h(tau)*T(tau)/delta) * G1  (combined scalar = 151/delta)
const proof_c =
  #"b697c05f3d58d125ed8630e8f547dd5a952c33753b65629e18efcada75d443690fc1f3759dfb55edc35e4d03dd17860e"

// ---------------------------------------------------------------------------
// Convenience constructors (for backward compatibility / tests)
// ---------------------------------------------------------------------------

/// The hard-coded valid proof for the concrete circuit.
pub fn hardcoded_proof() -> Proof {
  Proof { a: proof_a, b: proof_b, c: proof_c }
}

/// The hard-coded verification key for the concrete 3-constraint circuit.
pub fn hardcoded_verification_key() -> VerificationKey {
  VerificationKey {
    alpha_g1,
    beta_g2,
    gamma_g2,
    delta_g2,
    ic: [
      // Variable 0 (constant `1`) — point at infinity
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      // Variable 1 (output `a`) — psi_v_g1_1
      psi_v_g1_1,
      // Variables 2..7 are private — their ic entries are never used by the verifier,
      // but we include them so `ic` has one entry per variable (8 total).
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    ],
    n_public: 2,
  }
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

/// Verify a Groth16 proof against a supplied verification key.
///
/// * `proof`         – compressed points `(A, B, C)`.
/// * `public_inputs` – list of public witness values. The length must match
///                     `vk.n_public`. Variable 0 is the constant `1`.
/// * `vk`            – verification key containing CRS points and `ic` list.
///
/// Returns `True` iff the Groth16 pairing equation holds.
pub fn verify(
  proof: Proof,
  public_inputs: List<Int>,
  vk: VerificationKey,
) -> Bool {
  // Decompress proof points.
  let a = bls12_381_g1_uncompress(proof.a)
  let b = bls12_381_g2_uncompress(proof.b)
  let c = bls12_381_g1_uncompress(proof.c)

  // Decompress VK fixed points.
  let alpha = bls12_381_g1_uncompress(vk.alpha_g1)
  let beta = bls12_381_g2_uncompress(vk.beta_g2)
  let gamma = bls12_381_g2_uncompress(vk.gamma_g2)
  let delta = bls12_381_g2_uncompress(vk.delta_g2)

  // Compute the public-input commitment V.
  let v = compute_public_input_commitment(public_inputs, vk.ic, vk.n_public)

  // Pairing check:
  //   e(A, B) == e(alpha·G1, beta·G2) · e(C, delta·G2) · e(V, gamma·G2)
  let lhs = bls12_381_miller_loop(a, b)

  let rhs = bls12_381_miller_loop(alpha, beta)
  let rhs =
    bls12_381_mul_miller_loop_result(rhs, bls12_381_miller_loop(c, delta))
  let rhs =
    bls12_381_mul_miller_loop_result(rhs, bls12_381_miller_loop(v, gamma))

  bls12_381_final_verify(lhs, rhs)
}

/// Compute the public-input commitment `V = Σ a_i · ic[i]`.
///
/// * `public_inputs` – witness values for the public variables.
/// * `ic`            – list of compressed G1 points (`Psi_V_G1`), one per variable.
/// * `n_public`      – number of public variables to consume from the front of the lists.
///
/// Returns the identity point if the input lengths are mismatched or `n_public`
/// is zero — this causes the pairing check to fail for malformed input.
fn compute_public_input_commitment(
  public_inputs: List<Int>,
  ic: List<ByteArray>,
  n_public: Int,
) -> G1Element {
  // Build the MSM over the first `n_public` entries.
  do_compute_v(public_inputs, ic, n_public, g1.zero)
}

/// Tail-recursive helper that accumulates `v` one public input at a time.
fn do_compute_v(
  public_inputs: List<Int>,
  ic: List<ByteArray>,
  remaining: Int,
  acc: G1Element,
) -> G1Element {
  if remaining <= 0 {
    acc
  } else {
    when (public_inputs, ic) is {
      ([input, ..rest_inputs], [ic_point, ..rest_ic]) -> {
        let pt = bls12_381_g1_uncompress(ic_point)
        let s = scalar.from_int(input)
        let weighted = g1.scale(pt, s)
        do_compute_v(
          rest_inputs,
          rest_ic,
          remaining - 1,
          bls12_381_g1_add(acc, weighted),
        )
      }
      _ -> g1.zero
    }
  }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

test test_verify_hardcoded_proof() {
  let proof = hardcoded_proof()
  let vk = hardcoded_verification_key()
  verify(proof, [1, 48], vk)
}

test test_verify_reject_wrong_public_input() {
  let proof = hardcoded_proof()
  let vk = hardcoded_verification_key()
  // Wrong public output (49 instead of 48) changes V and breaks the pairing.
  !verify(proof, [1, 49], vk)
}

test test_verify_reject_tampered_proof() {
  let vk = hardcoded_verification_key()
  // Replace C with the G1 generator: valid point, wrong proof.
  let bad_c =
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
  let bad_proof = Proof { a: proof_a, b: proof_b, c: bad_c }
  !verify(bad_proof, [1, 48], vk)
}

test test_compute_public_input_commitment_matches_expected_v() {
  let vk = hardcoded_verification_key()
  let v = compute_public_input_commitment([1, 48], vk.ic, vk.n_public)
  let expected_v =
    bls12_381_g1_uncompress(
      #"b5ae7b97f37351dbfa7c343f60ac8c1c53a4ab74b227970e8415d5d7a791498cdb0f4bd32809129a90096188dea1b8a0",
    )
  g1.equal(v, expected_v)
}
