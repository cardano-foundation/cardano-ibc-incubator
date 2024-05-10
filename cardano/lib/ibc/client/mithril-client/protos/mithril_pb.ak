// DO NOT EDIT.
// source: ibc/clients/mithril/v1/mithril.proto

use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/bytearray.{concat, length, push}
use aiken/list
use aiken/option.{is_none}
use ibc/utils/bytes.{encode_varint, sov}
use ibc/utils/int.{uint64}

pub type MithrilClientState {
  chain_id: ByteArray,
  latest_height: Option<MithrilHeight>,
  frozen_height: Option<MithrilHeight>,
  current_epoch: Int,
  trusting_period: Int,
  protocol_parameters: Option<MithrilProtocolParameters>,
  upgrade_path: List<ByteArray>,
}

pub type MithrilHeight {
  mithril_height: Int,
}

pub type MithrilProtocolParameters {
  k: Int,
  m: Int,
  phi_f: Int,
}

pub type AnyMithrilClientState {
  type_url: ByteArray,
  value: Option<MithrilClientState>,
}

pub type MithrilDuration {
  seconds: Int,
  nanos: Int,
}

pub fn marshal_for_any_client_state(
  amcs_opt: Option<AnyMithrilClientState>,
) -> ByteArray {
  ite(
    is_none(amcs_opt),
    #[],
    {
      expect Some(amcs) = amcs_opt
      let AnyMithrilClientState { type_url, value } = amcs
      #[]
        |> concat(
            ite(
              length(type_url) == 0,
              #[],
              type_url
                |> length()
                |> uint64()
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
                |> uint64()
                |> encode_varint()
                |> concat(marshal_for_client_state(value))
                |> push(0x12),
            ),
          )
    },
  )
}

pub fn marshal_for_client_state(
  client_state_opt: Option<MithrilClientState>,
) -> ByteArray {
  ite(
    is_none(client_state_opt),
    #[],
    {
      expect Some(client_state) = client_state_opt
      let MithrilClientState {
        chain_id,
        latest_height,
        frozen_height,
        current_epoch,
        trusting_period,
        protocol_parameters,
        upgrade_path,
      } = client_state
      #[]
        |> concat(
            ite(
              length(chain_id) == 0,
              #[],
              chain_id
                |> length()
                |> uint64()
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
                |> uint64()
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
                |> uint64()
                |> encode_varint()
                |> concat(marshal_for_height(frozen_height))
                |> push(0x1a),
            ),
          )
        |> concat(
            ite(
              current_epoch == 0,
              #[],
              current_epoch |> uint64() |> encode_varint() |> push(0x20),
            ),
          )
        |> concat(
            {
              let tp_dur = duration_proto(trusting_period)
              ite(
                is_none(tp_dur),
                #[],
                tp_dur
                  |> size_for_duration()
                  |> uint64()
                  |> encode_varint()
                  |> concat(marshal_for_duration(tp_dur))
                  |> push(0x2a),
              )
            },
          )
        |> concat(
            ite(
              is_none(protocol_parameters),
              #[],
              protocol_parameters
                |> size_for_protocol_parameters()
                |> uint64()
                |> encode_varint()
                |> concat(marshal_for_protocol_parameters(protocol_parameters))
                |> push(0x32),
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
                              |> encode_varint()
                              |> concat(up)
                              |> push(0x3a),
                          )
                    },
                  ),
            ),
          )
    },
  )
}

pub fn size_for_client_state(
  client_state_opt: Option<MithrilClientState>,
) -> Int {
  ite(
    is_none(client_state_opt),
    0,
    {
      expect Some(client_state) = client_state_opt
      let MithrilClientState {
        chain_id,
        latest_height,
        frozen_height,
        current_epoch,
        trusting_period,
        protocol_parameters,
        upgrade_path,
      } = client_state
      0
        |> add(
            ite(
              length(chain_id) == 0,
              0,
              {
                let l = length(chain_id)
                l |> uint64() |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              is_none(latest_height),
              0,
              {
                let l = size_for_height(latest_height)
                l |> uint64() |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              is_none(frozen_height),
              0,
              {
                let l = size_for_height(frozen_height)
                l |> uint64() |> sov() |> add(l + 1)
              },
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
            {
              let tp_dur = duration_proto(trusting_period)

              ite(
                is_none(tp_dur),
                0,
                {
                  let l = size_for_duration(tp_dur)
                  l |> uint64() |> sov() |> add(l + 1)
                },
              )
            },
          )
        |> add(
            ite(
              is_none(protocol_parameters),
              0,
              {
                let l = size_for_protocol_parameters(protocol_parameters)
                l |> uint64() |> sov() |> add(l + 1)
              },
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
                        |> sov()
                        |> add(l + 1 + sz)
                    },
                  ),
            ),
          )
    },
  )
}

pub fn marshal_for_height(height_opt: Option<MithrilHeight>) -> ByteArray {
  ite(
    is_none(height_opt),
    #[],
    {
      expect Some(height) = height_opt
      let MithrilHeight { mithril_height } = height
      #[]
        |> concat(
            ite(
              mithril_height == 0,
              #[],
              mithril_height |> uint64() |> encode_varint() |> push(8),
            ),
          )
    },
  )
}

pub fn size_for_height(height_opt: Option<MithrilHeight>) -> Int {
  ite(
    is_none(height_opt),
    0,
    {
      expect Some(height) = height_opt
      let MithrilHeight { mithril_height } = height
      0
        |> add(
            ite(
              mithril_height == 0,
              0,
              mithril_height |> uint64() |> sov() |> add(1),
            ),
          )
    },
  )
}

pub fn marshal_for_protocol_parameters(
  pp_opt: Option<MithrilProtocolParameters>,
) -> ByteArray {
  ite(
    is_none(pp_opt),
    #[],
    {
      expect Some(pp) = pp_opt
      let MithrilProtocolParameters { k, m, phi_f } = pp
      #[]
        |> concat(ite(k == 0, #[], k |> uint64() |> encode_varint() |> push(8)))
        |> concat(ite(m == 0, #[], m |> uint64() |> encode_varint() |> push(0x10)))
        |> concat(
            ite(
              phi_f == 0,
              #[],
              phi_f |> uint64() |> encode_varint() |> push(0x18),
            ),
          )
    },
  )
}

pub fn size_for_protocol_parameters(
  pp_opt: Option<MithrilProtocolParameters>,
) -> Int {
  ite(
    is_none(pp_opt),
    0,
    {
      expect Some(pp) = pp_opt
      let MithrilProtocolParameters { k, m, phi_f } = pp
      0
        |> add(ite(k == 0, 0, k |> uint64() |> sov() |> add(1)))
        |> add(ite(m == 0, 0, m |> uint64() |> sov() |> add(1)))
        |> add(ite(phi_f == 0, 0, phi_f |> uint64() |> sov() |> add(1)))
    },
  )
}

pub fn duration_proto(duration: Int) -> Option<MithrilDuration> {
  Some(
    MithrilDuration {
      seconds: duration / 1000000000,
      nanos: duration % 1000000000,
    },
  )
}

pub fn marshal_for_duration(duration_opt: Option<MithrilDuration>) -> ByteArray {
  ite(
    is_none(duration_opt),
    #[],
    {
      expect Some(duration) = duration_opt
      let MithrilDuration { seconds, nanos } = duration
      #[]
        |> concat(
            ite(
              seconds == 0,
              #[],
              seconds |> uint64() |> encode_varint() |> push(8),
            ),
          )
        |> concat(
            ite(
              nanos == 0,
              #[],
              nanos |> uint64() |> encode_varint() |> push(0x10),
            ),
          )
    },
  )
}

pub fn size_for_duration(duration_opt: Option<MithrilDuration>) -> Int {
  ite(
    is_none(duration_opt),
    0,
    {
      expect Some(duration) = duration_opt
      let MithrilDuration { seconds, nanos } = duration
      0
        |> add(ite(seconds == 0, 0, seconds |> uint64() |> sov() |> add(1)))
        |> add(ite(nanos == 0, 0, nanos |> uint64() |> sov() |> add(1)))
    },
  )
}

test test_marshal_for_client_state() {
  let cs =
    Some(
      MithrilClientState {
        chain_id: "chain-id",
        latest_height: Some(MithrilHeight { mithril_height: 11 }),
        frozen_height: Some(MithrilHeight { mithril_height: 12 }),
        current_epoch: 2,
        trusting_period: 10000,
        protocol_parameters: Some(
          MithrilProtocolParameters { k: 2, m: 3, phi_f: 4 },
        ),
        upgrade_path: ["abc", "xyz"],
      },
    )
  marshal_for_client_state(cs) == #"0a08636861696e2d69641202080b1a02080c20022a0310904e32060802100318043a036162633a0378797a"
}
