// DO NOT EDIT.
// source: ibc/clients/cardano/v1/cardano.proto

use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/bytearray.{concat, length, push}
use aiken/list
use aiken/option.{is_none}
use ibc/utils/bits.{band, bor, len64, shl, shr}
use ibc/utils/int.{Int64, Uint64, uint64}

pub type Height {
  revision_number: Uint64,
  revision_height: Uint64,
}

pub type ConsensusState {
  timestamp: Uint64,
  slot: Uint64,
}

pub type Validator {
  vrf_key_hash: ByteArray,
  pool_id: ByteArray,
}

pub type TokenConfigs {
  handler_token_unit: ByteArray,
  client_policy_id: ByteArray,
  connection_policy_id: ByteArray,
  channel_policy_id: ByteArray,
}

pub type ClientState {
  chain_id: ByteArray,
  latest_height: Option<Height>,
  frozen_height: Option<Height>,
  valid_after: Uint64,
  genesis_time: Uint64,
  current_epoch: Uint64,
  epoch_length: Uint64,
  slot_per_kes_period: Uint64,
  current_validator_set: List<Option<Validator>>,
  next_validator_set: List<Option<Validator>>,
  trusting_period: Uint64,
  upgrade_path: List<ByteArray>,
  token_configs: Option<TokenConfigs>,
}

pub fn marshal_for_height(height_opt: Option<Height>) -> ByteArray {
  ite(
    is_none(height_opt),
    #[],
    {
      expect Some(height) = height_opt
      let Height { revision_number, revision_height } = height
      #[]
        |> concat(
             ite(
               revision_number == 0,
               #[],
               revision_number |> uint64() |> encode_varint_cardano() |> push(8),
             ),
           )
        |> concat(
             ite(
               revision_height == 0,
               #[],
               revision_height
                 |> uint64()
                 |> encode_varint_cardano()
                 |> push(0x10),
             ),
           )
    },
  )
}

pub fn size_for_height(height_opt: Option<Height>) -> Int {
  ite(
    is_none(height_opt),
    0,
    {
      expect Some(height) = height_opt
      let Height { revision_number, revision_height } = height
      0
        |> add(
             ite(
               revision_number == 0,
               0,
               revision_number |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               revision_height == 0,
               0,
               revision_height |> uint64() |> sov_cardano() |> add(1),
             ),
           )
    },
  )
}

pub fn marshal_for_consensus_state(
  consensus_state_opt: Option<ConsensusState>,
) -> ByteArray {
  ite(
    is_none(consensus_state_opt),
    #[],
    {
      expect Some(consensus_state) = consensus_state_opt
      let ConsensusState { timestamp, slot } = consensus_state
      #[]
        |> concat(
             ite(
               timestamp == 0,
               #[],
               timestamp |> uint64() |> encode_varint_cardano() |> push(8),
             ),
           )
        |> concat(
             ite(
               slot == 0,
               #[],
               slot |> uint64() |> encode_varint_cardano() |> push(0x10),
             ),
           )
    },
  )
}

pub fn size_for_consensus_state(
  consensus_state_opt: Option<ConsensusState>,
) -> Int {
  ite(
    is_none(consensus_state_opt),
    0,
    {
      expect Some(consensus_state) = consensus_state_opt
      let ConsensusState { timestamp, slot } = consensus_state
      0
        |> add(
             ite(
               timestamp == 0,
               0,
               timestamp |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(ite(slot == 0, 0, slot |> uint64() |> sov_cardano() |> add(1)))
    },
  )
}

pub fn marshal_for_validator(validator_opt: Option<Validator>) -> ByteArray {
  ite(
    is_none(validator_opt),
    #[],
    {
      expect Some(validator_) = validator_opt
      let Validator { vrf_key_hash, pool_id } = validator_
      #[]
        |> concat(
             ite(
               length(vrf_key_hash) == 0,
               #[],
               vrf_key_hash
                 |> length()
                 |> uint64()
                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
                 |> concat(pool_id)
                 |> push(0x12),
             ),
           )
    },
  )
}

pub fn size_for_validator(validator_opt: Option<Validator>) -> Int {
  ite(
    is_none(validator_opt),
    0,
    {
      expect Some(validator_) = validator_opt
      let Validator { vrf_key_hash, pool_id } = validator_
      0
        |> add(
             ite(
               length(vrf_key_hash) == 0,
               0,
               {
                 let l = length(vrf_key_hash)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               length(pool_id) == 0,
               0,
               {
                 let l = length(pool_id)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
    },
  )
}

pub fn marshal_for_token_configs(
  token_configs_opt: Option<TokenConfigs>,
) -> ByteArray {
  ite(
    is_none(token_configs_opt),
    #[],
    {
      expect Some(token_configs) = token_configs_opt
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
                 |> uint64()
                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
                 |> concat(channel_policy_id)
                 |> push(0x22),
             ),
           )
    },
  )
}

pub fn size_for_token_configs(token_configs_opt: Option<TokenConfigs>) -> Int {
  ite(
    is_none(token_configs_opt),
    0,
    {
      expect Some(token_configs) = token_configs_opt
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
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               length(client_policy_id) == 0,
               0,
               {
                 let l = length(client_policy_id)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               length(connection_policy_id) == 0,
               0,
               {
                 let l = length(connection_policy_id)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               length(channel_policy_id) == 0,
               0,
               {
                 let l = length(channel_policy_id)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
    },
  )
}

pub fn marshal_for_client_state(
  client_state_opt: Option<ClientState>,
) -> ByteArray {
  ite(
    is_none(client_state_opt),
    #[],
    {
      expect Some(client_state) = client_state_opt
      let ClientState {
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
                 |> uint64()
                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
                 |> concat(marshal_for_height(frozen_height))
                 |> push(0x1a),
             ),
           )
        |> concat(
             ite(
               valid_after == 0,
               #[],
               valid_after |> uint64() |> encode_varint_cardano() |> push(0x20),
             ),
           )
        |> concat(
             ite(
               genesis_time == 0,
               #[],
               genesis_time |> uint64() |> encode_varint_cardano() |> push(0x28),
             ),
           )
        |> concat(
             ite(
               current_epoch == 0,
               #[],
               current_epoch
                 |> uint64()
                 |> encode_varint_cardano()
                 |> push(0x30),
             ),
           )
        |> concat(
             ite(
               epoch_length == 0,
               #[],
               epoch_length |> uint64() |> encode_varint_cardano() |> push(0x38),
             ),
           )
        |> concat(
             ite(
               slot_per_kes_period == 0,
               #[],
               slot_per_kes_period
                 |> uint64()
                 |> encode_varint_cardano()
                 |> push(0x40),
             ),
           )
        |> concat(
             ite(
               list.length(current_validator_set) == 0,
               #[],
               current_validator_set
                 |> list.reduce(
                      #[],
                      fn(bz: ByteArray, validator_opt: Option<Validator>) -> ByteArray {
                        bz
                          |> concat(
                               validator_opt
                                 |> size_for_validator()
                                 |> uint64()
                                 |> encode_varint_cardano()
                                 |> concat(marshal_for_validator(validator_opt)),
                             )
                      },
                    )
                 |> push(0x4a),
             ),
           )
        |> concat(
             ite(
               list.length(next_validator_set) == 0,
               #[],
               next_validator_set
                 |> list.reduce(
                      #[],
                      fn(bz: ByteArray, validator_opt: Option<Validator>) -> ByteArray {
                        bz
                          |> concat(
                               validator_opt
                                 |> size_for_validator()
                                 |> uint64()
                                 |> encode_varint_cardano()
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
                 |> encode_varint_cardano()
                 |> push(0x58),
             ),
           )
        |> concat(
             ite(
               list.length(upgrade_path) == 0,
               #[],
               upgrade_path
                 |> list.reduce(
                      #[],
                      fn(bz: ByteArray, up: ByteArray) -> ByteArray {
                        bz
                          |> concat(
                               up
                                 |> length()
                                 |> uint64()
                                 |> encode_varint_cardano()
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
                 |> uint64()
                 |> encode_varint_cardano()
                 |> concat(marshal_for_token_configs(token_configs))
                 |> push(0x6a),
             ),
           )
    },
  )
}

pub fn size_for_client_state(client_state_opt: Option<ClientState>) -> Int {
  ite(
    is_none(client_state_opt),
    0,
    {
      expect Some(client_state) = client_state_opt
      let ClientState {
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
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               is_none(latest_height),
               0,
               {
                 let l = size_for_height(latest_height)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               is_none(frozen_height),
               0,
               {
                 let l = size_for_height(frozen_height)
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
        |> add(
             ite(
               valid_after == 0,
               0,
               valid_after |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               genesis_time == 0,
               0,
               genesis_time |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               current_epoch == 0,
               0,
               current_epoch |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               epoch_length == 0,
               0,
               epoch_length |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               slot_per_kes_period == 0,
               0,
               epoch_length |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               list.length(current_validator_set) == 0,
               0,
               current_validator_set
                 |> list.reduce(
                      0,
                      fn(sz: Int, validator_opt: Option<Validator>) -> Int {
                        let l = size_for_validator(validator_opt)
                        l
                          |> uint64()
                          |> sov_cardano()
                          |> add(l + 1 + sz)
                      },
                    ),
             ),
           )
        |> add(
             ite(
               list.length(next_validator_set) == 0,
               0,
               next_validator_set
                 |> list.reduce(
                      0,
                      fn(sz: Int, validator_opt: Option<Validator>) -> Int {
                        let l = size_for_validator(validator_opt)
                        l
                          |> uint64()
                          |> sov_cardano()
                          |> add(l + 1 + sz)
                      },
                    ),
             ),
           )
        |> add(
             ite(
               trusting_period == 0,
               0,
               trusting_period |> uint64() |> sov_cardano() |> add(1),
             ),
           )
        |> add(
             ite(
               list.length(upgrade_path) == 0,
               0,
               upgrade_path
                 |> list.reduce(
                      0,
                      fn(sz: Int, up: ByteArray) -> Int {
                        let l = length(up)
                        l
                          |> uint64()
                          |> sov_cardano()
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
                 l |> uint64() |> sov_cardano() |> add(l + 1)
               },
             ),
           )
    },
  )
}

fn encode_varint_cardano(v: Int64) -> ByteArray {
  ite(
    v >= ( 1 |> shl(7) ),
    v
      |> shr(7)
      |> encode_varint_cardano()
      |> push(
           v
             |> band(0x7f)
             |> bor(0x80),
         ),
    #[] |> push(v),
  )
}

fn sov_cardano(x: Int64) -> Int {
  x |> bor(1) |> len64() |> add(6) |> div(7)
}
