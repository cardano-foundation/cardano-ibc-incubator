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
    |> size_and_concat(
        encode_bytearray(chain_id, bytes.field_1_length_delimited),
      )
    |> add_and_concat(
        nest_record(
          marshal_for_height(latest_height),
          bytes.field_2_length_delimited,
        ),
      )
    // `frozen_height` is unset on the Cosmos chain until the client is actually frozen.
    // When it is unset, the on-chain stored bytes omit the entire field (proto3 presence).
    //
    // For membership verification on Cardano, we must reproduce the exact leaf value bytes,
    // so we omit `frozen_height` when it is the zero height (0/0).
    |> add_and_concat(
        if frozen_height.revision_number == 0 && frozen_height.revision_height == 0 {
          (0, #"")
        } else {
          nest_record(
            marshal_for_height(frozen_height),
            bytes.field_3_length_delimited,
          )
        },
      )
    |> add_and_concat(encode_int(current_epoch, bytes.field_4_varint))
    |> add_and_concat(
        nest_record(
          marshal_for_duration(duration_proto(trusting_period)),
          bytes.field_5_length_delimited,
        ),
      )
    |> add_and_concat(
        nest_record(
          marshal_for_protocol_parameters(protocol_parameters),
          bytes.field_6_length_delimited,
        ),
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
                |> push(bytes.field_7_length_delimited)
            (size + sov(l) + l + 1, concat(bz1, bz2))
          },
        ),
      )
    |> size_and_concat(
        encode_bytearray(
          host_state_nft_policy_id,
          bytes.field_8_length_delimited,
        ),
      )
    |> size_and_concat(
        encode_bytearray(
          host_state_nft_token_name,
          bytes.field_9_length_delimited,
        ),
      )
}

pub fn marshal_for_height(height: CardanoHeight) -> (Int, ByteArray) {
  let CardanoHeight { revision_number, revision_height } = height
  (0, #"")
    |> add_and_concat(encode_int(revision_number, bytes.field_1_varint))
    |> add_and_concat(encode_int(revision_height, bytes.field_2_varint))
}

pub fn marshal_for_protocol_parameters(
  pp: MithrilProtocolParameters,
) -> (Int, ByteArray) {
  let MithrilProtocolParameters { k, m, phi_f } = pp
  (0, #"")
    |> add_and_concat(encode_int(k, bytes.field_1_varint))
    |> add_and_concat(encode_int(m, bytes.field_2_varint))
    |> add_and_concat(
        nest_record(marshal_for_fraction(phi_f), bytes.field_3_length_delimited),
      )
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
    |> add_and_concat(encode_int(seconds, bytes.field_1_varint))
    |> add_and_concat(encode_int(nanos, bytes.field_2_varint))
}

pub fn marshal_for_fraction(fraction: Fraction) -> (Int, ByteArray) {
  let Fraction { numerator, denominator } = fraction
  (0, #"")
    |> add_and_concat(encode_int(numerator, bytes.field_1_varint))
    |> add_and_concat(encode_int(denominator, bytes.field_2_varint))
}
