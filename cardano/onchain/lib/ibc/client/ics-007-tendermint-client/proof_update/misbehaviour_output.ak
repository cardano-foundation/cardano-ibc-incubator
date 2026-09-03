// Canonical Solidity ABI encoding of Eureka's MisbehaviourOutput. Cardano
// durations are nanoseconds; Eureka encodes whole seconds as uint32 values.

use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output

pub type MisbehaviourOutput {
  client_state: ClientState,
  time: Int,
  trusted_height_1: Height,
  trusted_height_2: Height,
  trusted_consensus_state_1: ConsensusState,
  trusted_consensus_state_2: ConsensusState,
}

const two_to_64 = 18_446_744_073_709_551_616

const two_to_128 = 340_282_366_920_938_463_463_374_607_431_768_211_456

const word_bytes = 32

const top_level_tuple_offset = 32

const client_state_offset = 384

/// Encode the exact Solidity MisbehaviourOutput emitted by Eureka. The result
/// is 768 bytes for a chain ID up to 32 bytes and 800 bytes for 33–50 bytes.
pub fn encode(output: MisbehaviourOutput) -> Option<ByteArray> {
  when eureka_output.encode_client_state(output.client_state) is {
    Some(client_state_bytes) ->
      if is_encodable(output) {
        Some(
          concat_words(
            [
              uint_word(top_level_tuple_offset),
              uint_word(client_state_offset),
              uint_word(output.time),
              uint_word(output.trusted_height_1.revision_number),
              uint_word(output.trusted_height_1.revision_height),
              uint_word(output.trusted_height_2.revision_number),
              uint_word(output.trusted_height_2.revision_height),
              uint_word(output.trusted_consensus_state_1.timestamp),
              output.trusted_consensus_state_1.root.hash,
              output.trusted_consensus_state_1.next_validators_hash,
              uint_word(output.trusted_consensus_state_2.timestamp),
              output.trusted_consensus_state_2.root.hash,
              output.trusted_consensus_state_2.next_validators_hash,
            ],
          )
            |> bytearray.concat(client_state_bytes),
        )
      } else {
        None
      }
    None -> None
  }
}

fn is_encodable(output: MisbehaviourOutput) -> Bool {
  and {
    fits_uint(output.time, two_to_128),
    valid_height(output.trusted_height_1),
    valid_height(output.trusted_height_2),
    valid_consensus_state(output.trusted_consensus_state_1),
    valid_consensus_state(output.trusted_consensus_state_2),
  }
}

fn valid_height(height: Height) -> Bool {
  fits_uint(height.revision_number, two_to_64) && height.revision_height > 0 && fits_uint(
    height.revision_height,
    two_to_64,
  )
}

fn valid_consensus_state(consensus_state: ConsensusState) -> Bool {
  and {
    fits_uint(consensus_state.timestamp, two_to_128),
    bytearray.length(consensus_state.root.hash) == word_bytes,
    bytearray.length(consensus_state.next_validators_hash) == word_bytes,
  }
}

fn fits_uint(value: Int, upper_bound: Int) -> Bool {
  value >= 0 && value < upper_bound
}

fn uint_word(value: Int) -> ByteArray {
  bytearray.from_int_big_endian(value, word_bytes)
}

fn concat_words(words: List<ByteArray>) -> ByteArray {
  list.foldr(words, #"", fn(word, bytes) { bytearray.concat(word, bytes) })
}
