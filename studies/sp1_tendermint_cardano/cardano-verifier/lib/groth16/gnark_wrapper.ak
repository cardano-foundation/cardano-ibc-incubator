// Verifier for the BLS12-381 Groth16 proof emitted by the Cardano-specific
// gnark wrapper. gnark adds one BSB22 commitment for its emulated BN254 field
// checks, so this verifies both the Groth16 equation and the commitment proof.

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

/// Reproduce the custom gnark Fiat-Shamir scalar. The Go prover hashes the
/// domain followed by the canonical 48-byte compressed commitment and masks
/// the top three bits, so the result is below the BLS12-381 scalar modulus.
pub fn commitment_hash(commitment: ByteArray) -> Int {
  masked_sha256(bytearray.concat(commitment_hash_domain, commitment))
}

/// Build the public witness authenticated by the outer proof from the exact
/// SP1 program key and Eureka ABI output bytes supplied to the validator.
pub fn sp1_public_inputs(
  program_vkey: ByteArray,
  public_values: ByteArray,
) -> List<Int> {
  [1, bytearray.to_int_big_endian(program_vkey), masked_sha256(public_values)]
}

fn masked_sha256(bytes: ByteArray) -> Int {
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
  // Express the product-to-one equation as an equality for final_verify.
  bls12_381_final_verify(
    bls12_381_miller_loop(commitment, bls12_381_g2_uncompress(key.g_sigma_neg)),
    bls12_381_miller_loop(bls12_381_g1_neg(pok), bls12_381_g2_uncompress(key.g)),
  )
}

// ---------------------------------------------------------------------------
// Development setup fixture produced by bn254-to-bls-wrapper.
// ---------------------------------------------------------------------------

const fixture_program_vkey =
  #"00f170403d8173ed45e43a42ce66835f078fc5aa17be5673b1a7ad6143df097c"

const fixture_public_values =
  #"0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000018ac5aa0090c0265aef8b4344c566856024153a6d926846fa86247d424aa9a2897acdc903e550fd9a94f05181f311848889c44bf508e23f2c12685ab4e4090c2ac093e5d6114d39e00000000000000000000000000000000000000000000000018ac5b18c746809a480cf4c31bde380d1e21ab9f8b09eb211acee7bb5b5b773529e716cc30133a3fff1ca5b63e9d71d07c9aaffcb666e2fd8d4a2cfc00d324e7e8ec665a5b61f6db00000000000000000000000000000000000000000000000018ac5b2fb3bbc46800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000001d8647a00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000001d864d400000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000001d8647a000000000000000000000000000000000000000000000000000000000012750000000000000000000000000000000000000000000000000000000000001baf8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b636f736d6f736875622d34000000000000000000000000000000000000000000"

fn fixture_proof() -> Proof {
  Proof {
    a: #"ad049e03a39166cd46027b39d48560204ca2758851bce9920dfa6172ebf8e7d70f2e5eaa2545ded7a56a0c70220c652d",
    b: #"a674435d5b59631a1b9da36bf9a472e659ebddc93458a22d3fdaaebe6eee3780b63f22a824d278ea04a5aaca24a0ccaf141308b4c020406d71157a56b295ead1aa374423f57436b86cc5a5df6cf94e820ebc91c2f458345d8423703489925e6b",
    c: #"94dd0f9cb4f293b4834322e4c223c4fd87f749f82c3c08f6ad6164ffa559cf39939eeeab08738c22ebf40d42e8d96378",
    commitment: #"a751fcd6a58236d2744926eeb8bca2d23713bd32201496aae9c501636cbeb39ca4612ee8a5c0c2a8007d849ecfec8585",
    commitment_pok: #"a3b613a6f3fe65c3c4e3af2bb13aebe2159d017d4a2591b38e77aefe1a523acc6ef7c78d1d80bcc3418493f415bd6e43",
  }
}

fn fixture_vk() -> VerificationKey {
  VerificationKey {
    alpha_g1: #"a0e48692d1860834ee3d7cfc801646561d59bf8e509ded6118cdcda288f6d4396446575706f9b0c8a01a50254f4ba6d7",
    beta_g2: #"9407852422b11eb0e828ab64ffe87ca57da1eaeb9402a3001250e05b30777f98230f927e38e1efdb81b21a659626efd7152f792f8affabb764707348dbe3518686137ac2673e223f29310be593de1985b2314def41039b85cb79171cdd772c90",
    gamma_g2: #"b5dbc0f21c336508c7cc5f94a8a841b0a927c528a9562bc52914d11d299e0b9697334c7c6ac47da97960129a513695ab0976675c0af5eb743b851828d6fe0adab60a33835679320df37b2c27a4bf1a2e7316b8b5d21f1bf09814b59145257acb",
    delta_g2: #"979e39606219971adb0246c4a2dcde4c0edc9b473f6eda66b82ee33eac311070671d1057766e1204415f5a42462aadb41903b89bbb499c9d5544c6556b285f4cda92e6241c2f2f0096e343a8d7682585c652727100cb009ec7d6bb21b8aa2aad",
    ic: [
      #"af6ad2b9a8750705b143bbeff5f92b334808f61d09c8f80f6ea73461c221e121e01870c1a5fc665c0657f0b6a492cb96",
      #"a2c935b80accb23c5b9e5d90d02be2703e9a5e316d5d24f10645091061ad888f4eda1e1c3fed013d209acd21ac263ad9",
      #"a614dc826492cda6e2dd7acb87c45156c606fc70f4ec5a21211ce11347aa37332ca6ccd62eaddae5c849be37c08f73a8",
      #"a574d55fa9393575dfe5b5034c26d53752b9a33b29b4cd305db02e203f18b3d3b6328a07225e89f2c3aee286981ccfb1",
    ],
    commitment_key: CommitmentKey {
      g: #"90312b6be0abc4d630f2ec3bb600d0be74938b1a092b9cfb1a9f22076216353051d62783169bd234e3a2fe97c4c7a80a13454888fbdb830ad6c4138a0933d1e9b99178b3b9415d0107eecddabd505c1acf2492b514da6c0876f5cf6c08609b9a",
      g_sigma_neg: #"b09d303c9ed5c35958f382343a0f84c01982efd74338e77709b56b56cd6fac833ea3efd7344f9c61c480c87dc83bd91d160dbb5d63c429305b4d4234197178abae3231604db3c3931da3c4652b661a7befd9e2d2e155e2829d8fec9a49ed7bf4",
    },
  }
}

test wrapped_eureka_proof_verifies_on_cardano() {
  verify(
    fixture_proof(),
    sp1_public_inputs(fixture_program_vkey, fixture_public_values),
    fixture_vk(),
  )
}

test commitment_transcript_matches_go_wrapper() {
  bytearray.from_int_big_endian(commitment_hash(fixture_proof().commitment), 32) == #"1589d10f2d7b601456fe122e5a84cecdd1a5ff7aee0f80ee55e3e7494106dc81"
}

test wrapped_eureka_proof_rejects_changed_public_values() {
  let changed_public_values =
    bytearray.concat(#"01", bytearray.drop(fixture_public_values, 1))
  !verify(
    fixture_proof(),
    sp1_public_inputs(fixture_program_vkey, changed_public_values),
    fixture_vk(),
  )
}

test wrapped_eureka_proof_rejects_changed_commitment_pok() {
  let proof = fixture_proof()
  let changed_proof =
    Proof {
      a: proof.a,
      b: proof.b,
      c: proof.c,
      commitment: proof.commitment,
      commitment_pok: #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    }
  !verify(
    changed_proof,
    sp1_public_inputs(fixture_program_vkey, fixture_public_values),
    fixture_vk(),
  )
}
