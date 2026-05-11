use aiken/collection/list
use aiken/primitive/bytearray.{concat, length, push}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_length_varint,
  nest_record, reduce, size_and_concat, sov,
}
use ibc/utils/int.{Uint64}

pub type CardanoHeight {
  revision_number: Uint64,
  revision_height: Uint64,
}

pub type CardanoConsensusState {
  timestamp: Uint64,
  slot: Uint64,
}

pub type CardanoValidator {
  vrf_key_hash: ByteArray,
  pool_id: ByteArray,
}

pub type TokenConfigs {
  handler_token_unit: ByteArray,
  client_policy_id: ByteArray,
  connection_policy_id: ByteArray,
  channel_policy_id: ByteArray,
}

pub type CardanoClientState {
  chain_id: ByteArray,
  latest_height: CardanoHeight,
  frozen_height: CardanoHeight,
  valid_after: Uint64,
  genesis_time: Uint64,
  current_epoch: Uint64,
  epoch_length: Uint64,
  slot_per_kes_period: Uint64,
  current_validator_set: List<CardanoValidator>,
  next_validator_set: List<CardanoValidator>,
  trusting_period: Uint64,
  upgrade_path: List<ByteArray>,
  token_configs: TokenConfigs,
}

pub type AnyCardanoClientState {
  type_url: ByteArray,
  value: CardanoClientState,
}

pub fn marshal_for_any_client_state(
  accs: AnyCardanoClientState,
) -> (Int, ByteArray) {
  let AnyCardanoClientState { type_url, value } = accs
  (0, #"")
    |> add_and_concat(
        encode_bytearray(type_url, bytes.field_1_length_delimited),
      )
    |> add_and_concat(
        nest_record(
          marshal_for_client_state(value),
          bytes.field_2_length_delimited,
        ),
      )
}

pub fn marshal_for_height(height: CardanoHeight) -> (Int, ByteArray) {
  let CardanoHeight { revision_number, revision_height } = height
  (0, #"")
    |> add_and_concat(encode_int(revision_number, bytes.field_1_varint))
    |> add_and_concat(encode_int(revision_height, bytes.field_2_varint))
}

pub fn marshal_for_consensus_state(
  consensus_state: CardanoConsensusState,
) -> (Int, ByteArray) {
  let CardanoConsensusState { timestamp, slot } = consensus_state
  (0, #"")
    |> add_and_concat(encode_int(timestamp, bytes.field_1_varint))
    |> add_and_concat(encode_int(slot, bytes.field_2_varint))
}

pub fn marshal_for_validator(validator_: CardanoValidator) -> (Int, ByteArray) {
  let CardanoValidator { vrf_key_hash, pool_id } = validator_
  (0, #"")
    |> size_and_concat(
        encode_bytearray(vrf_key_hash, bytes.field_1_length_delimited),
      )
    |> size_and_concat(
        encode_bytearray(pool_id, bytes.field_2_length_delimited),
      )
}

pub fn marshal_for_token_configs(
  token_configs: TokenConfigs,
) -> (Int, ByteArray) {
  let TokenConfigs {
    handler_token_unit,
    client_policy_id,
    connection_policy_id,
    channel_policy_id,
  } = token_configs
  (0, #"")
    |> size_and_concat(
        encode_bytearray(handler_token_unit, bytes.field_1_length_delimited),
      )
    |> size_and_concat(
        encode_bytearray(client_policy_id, bytes.field_2_length_delimited),
      )
    |> size_and_concat(
        encode_bytearray(connection_policy_id, bytes.field_3_length_delimited),
      )
    |> size_and_concat(
        encode_bytearray(channel_policy_id, bytes.field_4_length_delimited),
      )
}

pub fn marshal_for_client_state(
  client_state: CardanoClientState,
) -> (Int, ByteArray) {
  let CardanoClientState {
    chain_id,
    latest_height,
    frozen_height,
    valid_after,
    genesis_time,
    current_epoch,
    epoch_length,
    slot_per_kes_period,
    current_validator_set,
    next_validator_set,
    trusting_period,
    upgrade_path,
    token_configs,
  } = client_state
  (0, #"")
    |> size_and_concat(
        encode_bytearray(chain_id, bytes.field_1_length_delimited),
      )
    |> add_and_concat(
        nest_record(
          marshal_for_height(latest_height),
          bytes.field_2_length_delimited,
        ),
      )
    |> add_and_concat(
        nest_record(
          marshal_for_height(frozen_height),
          bytes.field_3_length_delimited,
        ),
      )
    |> add_and_concat(encode_int(valid_after, bytes.field_4_varint))
    |> add_and_concat(encode_int(genesis_time, bytes.field_5_varint))
    |> add_and_concat(encode_int(current_epoch, bytes.field_6_varint))
    |> add_and_concat(encode_int(epoch_length, bytes.field_7_varint))
    |> add_and_concat(encode_int(slot_per_kes_period, bytes.field_8_varint))
    |> add_and_concat(
        reduce(
          current_validator_set,
          marshal_for_validator,
          bytes.field_9_length_delimited,
        ),
      )
    |> add_and_concat(
        reduce(
          next_validator_set,
          marshal_for_validator,
          bytes.field_10_length_delimited,
        ),
      )
    |> add_and_concat(encode_int(trusting_period, bytes.field_11_varint))
    |> add_and_concat(
        list.reduce(
          upgrade_path,
          (0, #[]),
          fn((size, bz1), path: ByteArray) -> (Int, ByteArray) {
            let l = length(path)
            let bz2 =
              l
                |> encode_length_varint()
                |> concat(path)
                |> push(bytes.field_12_length_delimited)
            (size + sov(l) + l + 1, concat(bz1, bz2))
          },
        ),
      )
    |> add_and_concat(
        nest_record(
          marshal_for_token_configs(token_configs),
          bytes.field_13_length_delimited,
        ),
      )
}
