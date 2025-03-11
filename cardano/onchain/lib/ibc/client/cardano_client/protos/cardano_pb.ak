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
    |> add_and_concat(encode_bytearray(type_url, 10))
    |> add_and_concat(nest_record(marshal_for_client_state(value), 0x12))
}

pub fn marshal_for_height(height: CardanoHeight) -> (Int, ByteArray) {
  let CardanoHeight { revision_number, revision_height } = height
  (0, #"")
    |> add_and_concat(encode_int(revision_number, 8))
    |> add_and_concat(encode_int(revision_height, 0x10))
}

pub fn marshal_for_consensus_state(
  consensus_state: CardanoConsensusState,
) -> (Int, ByteArray) {
  let CardanoConsensusState { timestamp, slot } = consensus_state
  (0, #"")
    |> add_and_concat(encode_int(timestamp, 8))
    |> add_and_concat(encode_int(slot, 0x10))
}

pub fn marshal_for_validator(validator_: CardanoValidator) -> (Int, ByteArray) {
  let CardanoValidator { vrf_key_hash, pool_id } = validator_
  (0, #"")
    |> size_and_concat(encode_bytearray(vrf_key_hash, 10))
    |> size_and_concat(encode_bytearray(pool_id, 0x12))
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
    |> size_and_concat(encode_bytearray(handler_token_unit, 10))
    |> size_and_concat(encode_bytearray(client_policy_id, 0x12))
    |> size_and_concat(encode_bytearray(connection_policy_id, 0x1a))
    |> size_and_concat(encode_bytearray(channel_policy_id, 0x22))
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
    |> size_and_concat(encode_bytearray(chain_id, 10))
    |> add_and_concat(nest_record(marshal_for_height(latest_height), 0x12))
    |> add_and_concat(nest_record(marshal_for_height(frozen_height), 0x1a))
    |> add_and_concat(encode_int(valid_after, 0x20))
    |> add_and_concat(encode_int(genesis_time, 0x28))
    |> add_and_concat(encode_int(current_epoch, 0x30))
    |> add_and_concat(encode_int(epoch_length, 0x38))
    |> add_and_concat(encode_int(slot_per_kes_period, 0x40))
    |> add_and_concat(
        reduce(current_validator_set, marshal_for_validator, 0x4a),
      )
    |> add_and_concat(reduce(next_validator_set, marshal_for_validator, 0x52))
    |> add_and_concat(encode_int(trusting_period, 0x58))
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
                |> push(0x62)
            (size + sov(l) + l + 1, concat(bz1, bz2))
          },
        ),
      )
    |> add_and_concat(
        nest_record(marshal_for_token_configs(token_configs), 0x6a),
      )
}
