// Canonical Solidity ABI encoding of Eureka's UpdateClientOutput. Cardano
// durations are nanoseconds; Eureka encodes whole seconds as uint32 values.

use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{max_chain_id_len}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}

pub type UpdateClientOutput {
  client_state: ClientState,
  trusted_consensus_state: ConsensusState,
  new_consensus_state: ConsensusState,
  time: Int,
  trusted_height: Height,
  new_height: Height,
}

const nanoseconds_per_second = 1_000_000_000

/// Eureka's Solidity-to-Tendermint conversion fixes this value at 15 seconds;
/// it is not part of either proof's public output.
pub const eureka_max_clock_drift = 15_000_000_000

const two_to_8 = 256

const two_to_32 = 4_294_967_296

const two_to_64 = 18_446_744_073_709_551_616

const two_to_128 = 340_282_366_920_938_463_463_374_607_431_768_211_456

const word_bytes = 32

const top_level_tuple_offset = 32

const client_state_offset = 384

const chain_id_offset = 288

const zero_word =
  #"0000000000000000000000000000000000000000000000000000000000000000"

/// Encode the exact Solidity `UpdateClientOutput` emitted by Eureka. This
/// returns `None` if a Cardano value cannot be represented by Eureka's ABI.
/// `max_clock_drift` and `proof_specs` are not present in Eureka's output. We
/// therefore require the exact clock drift fixed by Eureka rather than leaving
/// an unauthenticated Cardano value. Updates for a frozen Cardano client are
/// rejected instead of reducing its exact frozen height to Eureka's boolean.
pub fn encode(output: UpdateClientOutput) -> Option<ByteArray> {
  when encode_client_state(output.client_state) is {
    Some(client_state_bytes) ->
      if is_output_encodable(output) {
        Some(
          concat_words(
            [
              uint_word(top_level_tuple_offset),
              uint_word(client_state_offset),
              uint_word(output.trusted_consensus_state.timestamp),
              output.trusted_consensus_state.root.hash,
              output.trusted_consensus_state.next_validators_hash,
              uint_word(output.new_consensus_state.timestamp),
              output.new_consensus_state.root.hash,
              output.new_consensus_state.next_validators_hash,
              uint_word(output.time),
              uint_word(output.trusted_height.revision_number),
              uint_word(output.trusted_height.revision_height),
              uint_word(output.new_height.revision_number),
              uint_word(output.new_height.revision_height),
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

/// Encode Eureka's dynamic ClientState tuple. The returned bytes start at the
/// ClientState tuple head and include the padded dynamic chain ID.
pub fn encode_client_state(client_state: ClientState) -> Option<ByteArray> {
  let chain_id = client_state.chain_id
  let chain_id_length = bytearray.length(chain_id)
  let trust_level = client_state.trust_level

  if and {
    chain_id_length > 0,
    chain_id_length <= max_chain_id_len,
    fits_uint(trust_level.numerator, two_to_8),
    fits_uint(trust_level.denominator, two_to_8),
    trust_level.denominator > 0,
    trust_level.numerator > 0,
    trust_level.numerator <= trust_level.denominator,
    3 * trust_level.numerator >= trust_level.denominator,
    valid_height(client_state.latest_height),
    height_is_zero(client_state.frozen_height),
    valid_duration(client_state.trusting_period),
    valid_duration(client_state.unbonding_period),
    client_state.trusting_period < client_state.unbonding_period,
    client_state.max_clock_drift == eureka_max_clock_drift,
  } {
    let padded_chain_id_length =
      if chain_id_length <= word_bytes {
        word_bytes
      } else {
        2 * word_bytes
      }
    let padded_chain_id =
      bytearray.concat(
        chain_id,
        bytearray.take(zero_word, padded_chain_id_length - chain_id_length),
      )
    Some(
      concat_words(
        [
          uint_word(chain_id_offset),
          uint_word(trust_level.numerator),
          uint_word(trust_level.denominator),
          uint_word(client_state.latest_height.revision_number),
          uint_word(client_state.latest_height.revision_height),
          uint_word(client_state.trusting_period / nanoseconds_per_second),
          uint_word(client_state.unbonding_period / nanoseconds_per_second),
          bool_word(!height_is_zero(client_state.frozen_height)),
          // Eureka's Groth16 algorithm enum value.
          uint_word(0),
          uint_word(chain_id_length),
        ],
      )
        |> bytearray.concat(padded_chain_id),
    )
  } else {
    None
  }
}

fn is_output_encodable(output: UpdateClientOutput) -> Bool {
  let trusted_consensus_state = output.trusted_consensus_state
  let new_consensus_state = output.new_consensus_state

  and {
    fits_uint(trusted_consensus_state.timestamp, two_to_128),
    bytearray.length(trusted_consensus_state.root.hash) == word_bytes,
    bytearray.length(trusted_consensus_state.next_validators_hash) == word_bytes,
    fits_uint(new_consensus_state.timestamp, two_to_128),
    bytearray.length(new_consensus_state.root.hash) == word_bytes,
    bytearray.length(new_consensus_state.next_validators_hash) == word_bytes,
    fits_uint(output.time, two_to_128),
    valid_height(output.trusted_height),
    valid_height(output.new_height),
  }
}

fn valid_duration(duration: Int) -> Bool {
  duration > 0 && duration % nanoseconds_per_second == 0 && fits_uint(
    duration / nanoseconds_per_second,
    two_to_32,
  )
}

fn valid_height(height: Height) -> Bool {
  fits_uint(height.revision_number, two_to_64) && height.revision_height > 0 && fits_uint(
    height.revision_height,
    two_to_64,
  )
}

fn fits_uint(value: Int, upper_bound: Int) -> Bool {
  value >= 0 && value < upper_bound
}

fn height_is_zero(height: Height) -> Bool {
  height.revision_number == 0 && height.revision_height == 0
}

fn bool_word(value: Bool) -> ByteArray {
  if value {
    uint_word(1)
  } else {
    uint_word(0)
  }
}

fn uint_word(value: Int) -> ByteArray {
  bytearray.from_int_big_endian(value, word_bytes)
}

fn concat_words(words: List<ByteArray>) -> ByteArray {
  list.foldr(words, #"", fn(word, bytes) { bytearray.concat(word, bytes) })
}
