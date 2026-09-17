use aiken/crypto
use aiken/primitive/bytearray
use ibc/core/ics_002_client_semantics/registry.{ClientRegistration, Tendermint}
use ibc/utils/string

pub type RegistryCase {
  first: ClientRegistration,
  second: ClientRegistration,
  sequence: ByteArray,
  sequence_number: Int,
  reverse: Bool,
  reverse_references: Bool,
}

pub fn registry_case(
  suffix: Int,
  sequence: Int,
  seed: ByteArray,
  reverse: Bool,
  reverse_references: Bool,
) -> RegistryCase {
  let client_type = bytearray.concat("99-client-", string.int_to_string(suffix))
  RegistryCase {
    first: registration(client_type, seed),
    // A numeric suffix catches confusion between the type and instance number.
    second: registration(
      bytearray.concat(client_type, "-0"),
      bytearray.concat(seed, "other"),
    ),
    sequence: string.int_to_string(sequence),
    sequence_number: sequence,
    reverse,
    reverse_references,
  }
}

fn registration(client_type: ByteArray, seed: ByteArray) -> ClientRegistration {
  ClientRegistration {
    client_type,
    implementation: Tendermint,
    mint_policy: crypto.blake2b_224(bytearray.concat(seed, "mint")),
    spend_validator: crypto.blake2b_224(bytearray.concat(seed, "spend")),
    proof_policy: crypto.blake2b_224(bytearray.concat(seed, "proof")),
  }
}

pub fn registrations(sample: RegistryCase) -> List<ClientRegistration> {
  if sample.reverse {
    [sample.second, sample.first]
  } else {
    [sample.first, sample.second]
  }
}
