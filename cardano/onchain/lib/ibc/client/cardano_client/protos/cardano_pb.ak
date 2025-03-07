// DO NOT EDIT.
// source: ibc/clients/cardano/v1/cardano.proto

use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/collection/list
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, length, push}
use ibc/client/serde.{marshal, size}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_length_varint,
  encode_varint, nest_record, reduce, size_and_concat, sov,
}
use ibc/utils/int.{Uint64, uint64}

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
  latest_height: Option<CardanoHeight>,
  frozen_height: Option<CardanoHeight>,
  valid_after: Uint64,
  genesis_time: Uint64,
  current_epoch: Uint64,
  epoch_length: Uint64,
  slot_per_kes_period: Uint64,
  current_validator_set: List<Option<CardanoValidator>>,
  next_validator_set: List<Option<CardanoValidator>>,
  trusting_period: Uint64,
  upgrade_path: List<ByteArray>,
  token_configs: Option<TokenConfigs>,
}

pub type CardanoClientStateV2 {
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
  value: Option<CardanoClientState>,
}

pub type AnyCardanoClientStateV2 {
  type_url: ByteArray,
  value: CardanoClientStateV2,
}

pub fn marshal_for_any_client_state_v2(
  accs: AnyCardanoClientStateV2,
) -> (Int, ByteArray) {
  let AnyCardanoClientStateV2 { type_url, value } = accs
  (0, #"")
    |> add_and_concat(encode_bytearray(type_url, 10))
    |> add_and_concat(nest_record(marshal_for_client_state_v2(value), 0x12))
}

pub fn marshal_for_any_client_state(
  accs_opt: Option<AnyCardanoClientState>,
) -> ByteArray {
  marshal(
    accs_opt,
    fn(accs) {
      let AnyCardanoClientState { type_url, value } = accs
      #[]
        |> concat(
            ite(
              length(type_url) == 0,
              #[],
              type_url
                |> length()
                |> encode_varint()
                |> concat(type_url)
                |> push(10),
            ),
          )
        |> concat(
            ite(
              is_none(value),
              #[],
              value
                |> size_for_client_state()
                |> encode_varint()
                |> concat(marshal_for_client_state(value))
                |> push(0x12),
            ),
          )
    },
  )
}

pub fn marshal_for_height_v2(height: CardanoHeight) -> (Int, ByteArray) {
  let CardanoHeight { revision_number, revision_height } = height
  (0, #"")
    |> add_and_concat(encode_int(revision_number, 8))
    |> add_and_concat(encode_int(revision_height, 0x10))
}

pub fn marshal_for_height(height_opt: Option<CardanoHeight>) -> ByteArray {
  marshal(
    height_opt,
    fn(height) {
      let CardanoHeight { revision_number, revision_height } = height
      #[]
        |> concat(
            ite(
              revision_number == 0,
              #[],
              revision_number |> uint64() |> encode_varint() |> push(8),
            ),
          )
        |> concat(
            ite(
              revision_height == 0,
              #[],
              revision_height
                |> uint64()
                |> encode_varint()
                |> push(0x10),
            ),
          )
    },
  )
}

pub fn size_for_height(height_opt: Option<CardanoHeight>) -> Int {
  size(
    height_opt,
    fn(height) {
      let CardanoHeight { revision_number, revision_height } = height
      0
        |> add(
            ite(
              revision_number == 0,
              0,
              revision_number |> uint64() |> sov() |> add(1),
            ),
          )
        |> add(
            ite(
              revision_height == 0,
              0,
              revision_height |> uint64() |> sov() |> add(1),
            ),
          )
    },
  )
}

pub fn marshal_for_consensus_state_v2(
  consensus_state: CardanoConsensusState,
) -> (Int, ByteArray) {
  let CardanoConsensusState { timestamp, slot } = consensus_state
  (0, #"")
    |> add_and_concat(encode_int(timestamp, 8))
    |> add_and_concat(encode_int(slot, 0x10))
}

pub fn marshal_for_consensus_state(
  consensus_state_opt: Option<CardanoConsensusState>,
) -> ByteArray {
  marshal(
    consensus_state_opt,
    fn(consensus_state) {
      let CardanoConsensusState { timestamp, slot } = consensus_state
      #[]
        |> concat(
            ite(
              timestamp == 0,
              #[],
              timestamp |> uint64() |> encode_varint() |> push(8),
            ),
          )
        |> concat(
            ite(
              slot == 0,
              #[],
              slot |> uint64() |> encode_varint() |> push(0x10),
            ),
          )
    },
  )
}

pub fn size_for_consensus_state(
  consensus_state_opt: Option<CardanoConsensusState>,
) -> Int {
  size(
    consensus_state_opt,
    fn(consensus_state) {
      let CardanoConsensusState { timestamp, slot } = consensus_state
      0
        |> add(ite(timestamp == 0, 0, timestamp |> uint64() |> sov() |> add(1)))
        |> add(ite(slot == 0, 0, slot |> uint64() |> sov() |> add(1)))
    },
  )
}

pub fn marshal_for_validator_v2(
  validator_: CardanoValidator,
) -> (Int, ByteArray) {
  let CardanoValidator { vrf_key_hash, pool_id } = validator_
  (0, #"")
    |> size_and_concat(encode_bytearray(vrf_key_hash, 10))
    |> size_and_concat(encode_bytearray(pool_id, 0x12))
}

pub fn marshal_for_validator(
  validator_opt: Option<CardanoValidator>,
) -> ByteArray {
  marshal(
    validator_opt,
    fn(validator_) {
      let CardanoValidator { vrf_key_hash, pool_id } = validator_
      #[]
        |> concat(
            ite(
              length(vrf_key_hash) == 0,
              #[],
              vrf_key_hash
                |> length()
                |> encode_varint()
                |> concat(vrf_key_hash)
                |> push(10),
            ),
          )
        |> concat(
            ite(
              length(pool_id) == 0,
              #[],
              pool_id
                |> length()
                |> encode_varint()
                |> concat(pool_id)
                |> push(0x12),
            ),
          )
    },
  )
}

pub fn size_for_validator(validator_opt: Option<CardanoValidator>) -> Int {
  size(
    validator_opt,
    fn(validator_) {
      let CardanoValidator { vrf_key_hash, pool_id } = validator_
      0
        |> add(
            ite(
              length(vrf_key_hash) == 0,
              0,
              {
                let l = length(vrf_key_hash)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              length(pool_id) == 0,
              0,
              {
                let l = length(pool_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}

pub fn marshal_for_token_configs_v2(
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

pub fn marshal_for_token_configs(
  token_configs_opt: Option<TokenConfigs>,
) -> ByteArray {
  marshal(
    token_configs_opt,
    fn(token_configs) {
      let TokenConfigs {
        handler_token_unit,
        client_policy_id,
        connection_policy_id,
        channel_policy_id,
      } = token_configs
      #[]
        |> concat(
            ite(
              length(handler_token_unit) == 0,
              #[],
              handler_token_unit
                |> length()
                |> encode_varint()
                |> concat(handler_token_unit)
                |> push(10),
            ),
          )
        |> concat(
            ite(
              length(client_policy_id) == 0,
              #[],
              client_policy_id
                |> length()
                |> encode_varint()
                |> concat(client_policy_id)
                |> push(0x12),
            ),
          )
        |> concat(
            ite(
              length(connection_policy_id) == 0,
              #[],
              connection_policy_id
                |> length()
                |> encode_varint()
                |> concat(connection_policy_id)
                |> push(0x1a),
            ),
          )
        |> concat(
            ite(
              length(channel_policy_id) == 0,
              #[],
              channel_policy_id
                |> length()
                |> encode_varint()
                |> concat(channel_policy_id)
                |> push(0x22),
            ),
          )
    },
  )
}

pub fn size_for_token_configs(token_configs_opt: Option<TokenConfigs>) -> Int {
  size(
    token_configs_opt,
    fn(token_configs) {
      let TokenConfigs {
        handler_token_unit,
        client_policy_id,
        connection_policy_id,
        channel_policy_id,
      } = token_configs
      0
        |> add(
            ite(
              length(handler_token_unit) == 0,
              0,
              {
                let l = length(handler_token_unit)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              length(client_policy_id) == 0,
              0,
              {
                let l = length(client_policy_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              length(connection_policy_id) == 0,
              0,
              {
                let l = length(connection_policy_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              length(channel_policy_id) == 0,
              0,
              {
                let l = length(channel_policy_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}

pub fn marshal_for_client_state_v2(
  client_state: CardanoClientStateV2,
) -> (Int, ByteArray) {
  let CardanoClientStateV2 {
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
    |> add_and_concat(nest_record(marshal_for_height_v2(latest_height), 0x12))
    |> add_and_concat(nest_record(marshal_for_height_v2(frozen_height), 0x1a))
    |> add_and_concat(encode_int(valid_after, 0x20))
    |> add_and_concat(encode_int(genesis_time, 0x28))
    |> add_and_concat(encode_int(current_epoch, 0x30))
    |> add_and_concat(encode_int(epoch_length, 0x38))
    |> add_and_concat(encode_int(slot_per_kes_period, 0x40))
    |> add_and_concat(
        reduce(current_validator_set, marshal_for_validator_v2, 0x4a),
      )
    |> add_and_concat(
        reduce(next_validator_set, marshal_for_validator_v2, 0x52),
      )
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
        nest_record(marshal_for_token_configs_v2(token_configs), 0x6a),
      )
}

pub fn marshal_for_client_state(
  client_state_opt: Option<CardanoClientState>,
) -> ByteArray {
  marshal(
    client_state_opt,
    fn(client_state) {
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
      #[]
        |> concat(
            ite(
              length(chain_id) == 0,
              #[],
              chain_id
                |> length()
                |> encode_varint()
                |> concat(chain_id)
                |> push(10),
            ),
          )
        |> concat(
            ite(
              is_none(latest_height),
              #[],
              latest_height
                |> size_for_height()
                |> encode_varint()
                |> concat(marshal_for_height(latest_height))
                |> push(0x12),
            ),
          )
        |> concat(
            ite(
              is_none(frozen_height),
              #[],
              frozen_height
                |> size_for_height()
                |> encode_varint()
                |> concat(marshal_for_height(frozen_height))
                |> push(0x1a),
            ),
          )
        |> concat(
            ite(
              valid_after == 0,
              #[],
              valid_after |> uint64() |> encode_varint() |> push(0x20),
            ),
          )
        |> concat(
            ite(
              genesis_time == 0,
              #[],
              genesis_time |> uint64() |> encode_varint() |> push(0x28),
            ),
          )
        |> concat(
            ite(
              current_epoch == 0,
              #[],
              current_epoch |> uint64() |> encode_varint() |> push(0x30),
            ),
          )
        |> concat(
            ite(
              epoch_length == 0,
              #[],
              epoch_length |> uint64() |> encode_varint() |> push(0x38),
            ),
          )
        |> concat(
            ite(
              slot_per_kes_period == 0,
              #[],
              slot_per_kes_period |> uint64() |> encode_varint() |> push(0x40),
            ),
          )
        |> concat(
            ite(
              list.is_empty(current_validator_set),
              #[],
              current_validator_set
                |> list.reduce(
                    #[],
                    fn(bz: ByteArray, validator_opt: Option<CardanoValidator>) -> ByteArray {
                      bz
                        |> concat(
                            validator_opt
                              |> size_for_validator()
                              |> encode_varint()
                              |> concat(marshal_for_validator(validator_opt)),
                          )
                    },
                  )
                |> push(0x4a),
            ),
          )
        |> concat(
            ite(
              list.is_empty(next_validator_set),
              #[],
              next_validator_set
                |> list.reduce(
                    #[],
                    fn(bz: ByteArray, validator_opt: Option<CardanoValidator>) -> ByteArray {
                      bz
                        |> concat(
                            validator_opt
                              |> size_for_validator()
                              |> encode_varint()
                              |> concat(marshal_for_validator(validator_opt)),
                          )
                    },
                  )
                |> push(0x52),
            ),
          )
        |> concat(
            ite(
              trusting_period == 0,
              #[],
              trusting_period
                |> uint64()
                |> encode_varint()
                |> push(0x58),
            ),
          )
        |> concat(
            ite(
              list.is_empty(upgrade_path),
              #[],
              upgrade_path
                |> list.reduce(
                    #[],
                    fn(bz: ByteArray, up: ByteArray) -> ByteArray {
                      bz
                        |> concat(
                            up
                              |> length()
                              |> encode_varint()
                              |> concat(up)
                              |> push(0x62),
                          )
                    },
                  ),
            ),
          )
        |> concat(
            ite(
              is_none(token_configs),
              #[],
              token_configs
                |> size_for_token_configs()
                |> encode_varint()
                |> concat(marshal_for_token_configs(token_configs))
                |> push(0x6a),
            ),
          )
    },
  )
}

pub fn size_for_client_state(
  client_state_opt: Option<CardanoClientState>,
) -> Int {
  size(
    client_state_opt,
    fn(client_state) {
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
      0
        |> add(
            ite(
              length(chain_id) == 0,
              0,
              {
                let l = length(chain_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              is_none(latest_height),
              0,
              {
                let l = size_for_height(latest_height)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              is_none(frozen_height),
              0,
              {
                let l = size_for_height(frozen_height)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(valid_after == 0, 0, valid_after |> uint64() |> sov() |> add(1)),
          )
        |> add(
            ite(
              genesis_time == 0,
              0,
              genesis_time |> uint64() |> sov() |> add(1),
            ),
          )
        |> add(
            ite(
              current_epoch == 0,
              0,
              current_epoch |> uint64() |> sov() |> add(1),
            ),
          )
        |> add(
            ite(
              epoch_length == 0,
              0,
              epoch_length |> uint64() |> sov() |> add(1),
            ),
          )
        |> add(
            ite(
              slot_per_kes_period == 0,
              0,
              epoch_length |> uint64() |> sov() |> add(1),
            ),
          )
        |> add(
            ite(
              list.is_empty(current_validator_set),
              0,
              current_validator_set
                |> list.reduce(
                    0,
                    fn(sz: Int, validator_opt: Option<CardanoValidator>) -> Int {
                      let l = size_for_validator(validator_opt)
                      l
                        |> sov()
                        |> add(l + 1 + sz)
                    },
                  ),
            ),
          )
        |> add(
            ite(
              list.is_empty(next_validator_set),
              0,
              next_validator_set
                |> list.reduce(
                    0,
                    fn(sz: Int, validator_opt: Option<CardanoValidator>) -> Int {
                      let l = size_for_validator(validator_opt)
                      l
                        |> sov()
                        |> add(l + 1 + sz)
                    },
                  ),
            ),
          )
        |> add(
            ite(
              trusting_period == 0,
              0,
              trusting_period |> uint64() |> sov() |> add(1),
            ),
          )
        |> add(
            ite(
              list.is_empty(upgrade_path),
              0,
              upgrade_path
                |> list.reduce(
                    0,
                    fn(sz: Int, up: ByteArray) -> Int {
                      let l = length(up)
                      l
                        |> sov()
                        |> add(l + 1 + sz)
                    },
                  ),
            ),
          )
        |> add(
            ite(
              is_none(token_configs),
              0,
              {
                let l = size_for_token_configs(token_configs)
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}
