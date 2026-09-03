use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output.{
  UpdateClientOutput,
}
use ibc/client/ics_007_tendermint_client/proof_update/gnark_wrapper.{
  Proof, VerificationKey,
}

pub const proof_size = 288

const program_vkey_size = 32

const g1_size = 48

const g2_size = 96

/// Parse A || B || C || commitment || commitment-PoK from the wrapper's exact
/// 288-byte proof bundle.
pub fn unpack(bytes: ByteArray) -> Option<Proof> {
  if bytearray.length(bytes) == proof_size {
    Some(
      Proof {
        a: bytearray.take(bytes, g1_size),
        b: bytearray.slice(bytes, g1_size, g1_size + g2_size - 1),
        c: bytearray.slice(
          bytes,
          g1_size + g2_size,
          g1_size + g2_size + g1_size - 1,
        ),
        commitment: bytearray.slice(
          bytes,
          g1_size + g2_size + g1_size,
          g1_size + g2_size + g1_size + g1_size - 1,
        ),
        commitment_pok: bytearray.slice(
          bytes,
          g1_size + g2_size + g1_size + g1_size,
          proof_size - 1,
        ),
      },
    )
  } else {
    None
  }
}

/// Reconstruct the Eureka output and its two wrapper-bound public values.
pub fn public_inputs(
  program_vkey: ByteArray,
  output: UpdateClientOutput,
) -> Option<List<Int>> {
  if bytearray.length(program_vkey) != program_vkey_size {
    None
  } else {
    when eureka_output.encode(output) is {
      Some(public_values) ->
        Some(gnark_wrapper.sp1_public_inputs(program_vkey, public_values))
      None -> None
    }
  }
}

/// Verify a wrapped Eureka update proof against typed Cardano values. The
/// production validator must additionally pin `program_vkey` and `vk`.
pub fn verify(
  proof_bytes: ByteArray,
  program_vkey: ByteArray,
  output: UpdateClientOutput,
  vk: VerificationKey,
) -> Bool {
  when eureka_output.encode(output) is {
    Some(public_values) ->
      verify_encoded(proof_bytes, program_vkey, public_values, vk)
    None -> False
  }
}

/// Verify a wrapped proof against already reconstructed public values.
pub fn verify_encoded(
  proof_bytes: ByteArray,
  program_vkey: ByteArray,
  public_values: ByteArray,
  vk: VerificationKey,
) -> Bool {
  if bytearray.length(program_vkey) != program_vkey_size {
    False
  } else {
    when unpack(proof_bytes) is {
      Some(proof) ->
        gnark_wrapper.verify(
          proof,
          gnark_wrapper.sp1_public_inputs(program_vkey, public_values),
          vk,
        )
      None -> False
    }
  }
}
