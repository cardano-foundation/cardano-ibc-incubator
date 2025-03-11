use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, push}
use ibc/client/ics_007_tendermint_client/cometbft/protos/timestamp_pb.{
  Timestamp, timestamp_proto,
}
use ibc/utils/bytes.{encode_varint, sov}
use ibc/utils/int.{uint64}
use ibc/utils/time.{Time}

pub fn marshal_for_timestamp(ts_opt: Option<Timestamp>) -> ByteArray {
  ite(
    is_none(ts_opt),
    #[],
    {
      expect Some(ts) = ts_opt
      let Timestamp { seconds, nanos } = ts
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

pub fn size_for_timestamp(ts_opt: Option<Timestamp>) -> Int {
  ite(
    is_none(ts_opt),
    0,
    {
      expect Some(ts) = ts_opt
      let Timestamp { seconds, nanos } = ts
      0
        |> add(ite(seconds == 0, 0, seconds |> uint64() |> sov() |> add(1)))
        |> add(ite(nanos == 0, 0, nanos |> uint64() |> sov() |> add(1)))
    },
  )
}

pub fn size_of_std_time(t: Time) -> Int {
  let ts_opt = timestamp_proto(t)
  size_for_timestamp(ts_opt)
}
