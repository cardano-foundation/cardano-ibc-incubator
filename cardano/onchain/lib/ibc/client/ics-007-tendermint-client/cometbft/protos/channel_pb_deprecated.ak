use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/collection/list
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, length, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb.{
  Channel, Counterparty, order_to_int32, state_to_int32,
}
use ibc/utils/bytes.{encode_varint, sov}
use ibc/utils/int.{uint64}

pub fn marshal_for_counterparty(
  counterparty_opt: Option<Counterparty>,
) -> ByteArray {
  ite(
    is_none(counterparty_opt),
    #[],
    {
      expect Some(counterparty) = counterparty_opt
      let Counterparty { port_id, channel_id } = counterparty
      #[]
        |> concat(
            ite(
              length(port_id) == 0,
              #[],
              port_id
                |> length()
                |> encode_varint()
                |> concat(port_id)
                |> push(10),
            ),
          )
        |> concat(
            ite(
              length(channel_id) == 0,
              #[],
              channel_id
                |> length()
                |> encode_varint()
                |> concat(channel_id)
                |> push(0x12),
            ),
          )
    },
  )
}

pub fn size_for_counterparty(counterparty_opt: Option<Counterparty>) -> Int {
  ite(
    is_none(counterparty_opt),
    0,
    {
      expect Some(counterparty) = counterparty_opt
      let Counterparty { port_id, channel_id } = counterparty
      0
        |> add(
            ite(
              length(port_id) == 0,
              0,
              {
                let l = length(port_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              length(channel_id) == 0,
              0,
              {
                let l = length(channel_id)
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}

pub fn marshal_for_channel(channel_opt: Option<Channel>) -> ByteArray {
  ite(
    is_none(channel_opt),
    #[],
    {
      expect Some(channel) = channel_opt
      let Channel {
        state,
        ordering,
        counterparty,
        connection_hops,
        version,
        upgrade_sequence,
      } = channel
      #[]
        |> concat(
            ite(
              state_to_int32(state) == 0,
              #[],
              state
                |> state_to_int32()
                |> encode_varint()
                |> push(8),
            ),
          )
        |> concat(
            ite(
              order_to_int32(ordering) == 0,
              #[],
              ordering
                |> order_to_int32()
                |> encode_varint()
                |> push(0x10),
            ),
          )
        |> concat(
            counterparty
              |> Some()
              |> size_for_counterparty()
              |> encode_varint()
              |> concat(marshal_for_counterparty(Some(counterparty)))
              |> push(0x1a),
          )
        |> concat(
            ite(
              list.is_empty(connection_hops),
              #[],
              connection_hops
                |> list.reduce(
                    #[],
                    fn(bz: ByteArray, connection_hop: ByteArray) -> ByteArray {
                      bz
                        |> concat(
                            connection_hop
                              |> length()
                              |> encode_varint()
                              |> concat(connection_hop)
                              |> push(0x22),
                          )
                    },
                  ),
            ),
          )
        |> concat(
            ite(
              length(version) == 0,
              #[],
              version
                |> length()
                |> encode_varint()
                |> concat(version)
                |> push(0x2a),
            ),
          )
        |> concat(
            ite(
              upgrade_sequence == 0,
              #[],
              upgrade_sequence
                |> uint64()
                |> encode_varint()
                |> push(0x30),
            ),
          )
    },
  )
}

pub fn size_for_channel(channel_opt: Option<Channel>) -> Int {
  ite(
    is_none(channel_opt),
    0,
    {
      expect Some(channel) = channel_opt
      let Channel {
        state,
        ordering,
        counterparty,
        connection_hops,
        version,
        upgrade_sequence,
      } = channel
      0
        |> add(
            ite(
              state_to_int32(state) == 0,
              0,
              state
                |> state_to_int32()
                |> sov()
                |> add(1),
            ),
          )
        |> add(
            ite(
              order_to_int32(ordering) == 0,
              0,
              ordering
                |> order_to_int32()
                |> sov()
                |> add(1),
            ),
          )
        |> add(
            {
              let l = size_for_counterparty(Some(counterparty))
              l |> sov() |> add(l + 1)
            },
          )
        |> add(
            ite(
              list.is_empty(connection_hops),
              0,
              connection_hops
                |> list.reduce(
                    0,
                    fn(sz: Int, connection_hop: ByteArray) -> Int {
                      let l = length(connection_hop)
                      l
                        |> sov()
                        |> add(l + 1 + sz)
                    },
                  ),
            ),
          )
        |> add(
            ite(
              length(version) == 0,
              0,
              {
                let l = length(version)
                l |> sov() |> add(l + 1)
              },
            ),
          )
        |> add(
            ite(
              upgrade_sequence == 0,
              0,
              upgrade_sequence |> uint64() |> sov() |> add(1),
            ),
          )
    },
  )
}
