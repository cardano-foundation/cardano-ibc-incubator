use aiken/collection/list
use aiken/primitive/bytearray.{concat, length, push}
use ibc/utils/bytes.{
  add_and_concat, encode_bytearray, encode_int, encode_length_varint,
  nest_record, size_and_concat, sov,
}
use ibc/utils/int.{Uint64}

pub type MithrilClientState {
  chain_id: ByteArray,
  latest_height: CardanoHeight,
  frozen_height: CardanoHeight,
  current_epoch: Int,
  trusting_period: Int,
  protocol_parameters: MithrilProtocolParameters,
  upgrade_path: List<ByteArray>,
  host_state_nft_policy_id: ByteArray,
  host_state_nft_token_name: ByteArray,
}

pub type CardanoHeight {
  revision_number: Uint64,
  revision_height: Uint64,
}

pub type MithrilProtocolParameters {
  k: Int,
  m: Int,
  phi_f: Fraction,
}

pub type Fraction {
  numerator: Int,
  denominator: Int,
}

pub type AnyMithrilClientState {
  type_url: ByteArray,
  value: MithrilClientState,
}

pub type MithrilDuration {
  seconds: Int,
  nanos: Int,
}

pub fn marshal_for_any_client_state(
  amcs: AnyMithrilClientState,
) -> (Int, ByteArray) {
  let AnyMithrilClientState { type_url, value } = amcs
  (0, #"")
    |> add_and_concat(encode_bytearray(type_url, 10))
    |> add_and_concat(nest_record(marshal_for_client_state(value), 0x12))
}

pub fn marshal_for_client_state(
  client_state: MithrilClientState,
) -> (Int, ByteArray) {
  let MithrilClientState {
    chain_id,
    latest_height,
    frozen_height,
    current_epoch,
    trusting_period,
    protocol_parameters,
    upgrade_path,
    host_state_nft_policy_id,
    host_state_nft_token_name,
  } = client_state
  (0, #"")
    |> size_and_concat(encode_bytearray(chain_id, 10))
    |> add_and_concat(nest_record(marshal_for_height(latest_height), 0x12))
    |> add_and_concat(nest_record(marshal_for_height(frozen_height), 0x1a))
    |> add_and_concat(encode_int(current_epoch, 0x20))
    |> add_and_concat(
        nest_record(marshal_for_duration(duration_proto(trusting_period)), 0x2a),
      )
    |> add_and_concat(
        nest_record(marshal_for_protocol_parameters(protocol_parameters), 0x32),
      )
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
                |> push(0x3a)
            (size + sov(l) + l + 1, concat(bz1, bz2))
          },
        ),
      )
    |> add_and_concat(encode_bytearray(host_state_nft_policy_id, 0x42))
    |> add_and_concat(encode_bytearray(host_state_nft_token_name, 0x4a))
}

pub fn marshal_for_height(height: CardanoHeight) -> (Int, ByteArray) {
  let CardanoHeight { revision_number, revision_height } = height
  (0, #"")
    |> add_and_concat(encode_int(revision_number, 8))
    |> add_and_concat(encode_int(revision_height, 0x10))
}

pub fn marshal_for_protocol_parameters(
  pp: MithrilProtocolParameters,
) -> (Int, ByteArray) {
  let MithrilProtocolParameters { k, m, phi_f } = pp
  (0, #"")
    |> add_and_concat(encode_int(k, 8))
    |> add_and_concat(encode_int(m, 0x10))
    |> add_and_concat(nest_record(marshal_for_fraction(phi_f), 0x1a))
}

pub fn duration_proto(duration: Int) -> MithrilDuration {
  MithrilDuration {
    seconds: duration / 1000000000,
    nanos: duration % 1000000000,
  }
}

pub fn marshal_for_duration(duration: MithrilDuration) -> (Int, ByteArray) {
  let MithrilDuration { seconds, nanos } = duration
  (0, #"")
    |> add_and_concat(encode_int(seconds, 8))
    |> add_and_concat(encode_int(nanos, 0x10))
}

pub fn marshal_for_fraction(fraction: Fraction) -> (Int, ByteArray) {
  let Fraction { numerator, denominator } = fraction
  (0, #"")
    |> add_and_concat(encode_int(numerator, 8))
    |> add_and_concat(encode_int(denominator, 0x10))
}
