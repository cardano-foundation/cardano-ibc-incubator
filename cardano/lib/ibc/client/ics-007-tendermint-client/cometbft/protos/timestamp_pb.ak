// DO NOT EDIT.
// source: google/protobuf/timestamp.proto

use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/bytearray.{concat, push}
use aiken/option.{is_none}
use ibc/utils/bits.{band, bor, len64, shl, shr}
use ibc/utils/int.{Int32, Int64, uint64}
use ibc/utils/time.{Time}

const min_valid_seconds = -62135596800

const max_valid_seconds = 253402300800

pub type Timestamp {
  seconds: Int64,
  nanos: Int32,
}

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
               seconds |> uint64() |> encode_varint_timestamp() |> push(8),
             ),
           )
        |> concat(
             ite(
               nanos == 0,
               #[],
               nanos |> uint64() |> encode_varint_timestamp() |> push(0x10),
             ),
           )
    },
  )
}

pub fn size_of_std_time(t: Time) -> Int {
  let ts_opt = timestamp_proto(t)
  size_for_timestamp(ts_opt)
}

pub fn size_for_timestamp(ts_opt: Option<Timestamp>) -> Int {
  ite(
    is_none(ts_opt),
    0,
    {
      expect Some(ts) = ts_opt
      let Timestamp { seconds, nanos } = ts
      0
        |> add(
             ite(
               seconds == 0,
               0,
               seconds |> uint64() |> sov_timestamp() |> add(1),
             ),
           )
        |> add(ite(nanos == 0, 0, nanos |> uint64() |> sov_timestamp() |> add(1)))
    },
  )
}

fn sov_timestamp(x: Int64) -> Int {
  x |> bor(1) |> len64() |> add(6) |> div(7)
}

pub fn timestamp_proto(t: Time) -> Option<Timestamp> {
  let ts = Timestamp { seconds: second(t), nanos: nanosecond(t) }
  ite(validate_timestamp(Some(ts)), Some(ts), None)
}

fn second(t: Time) -> Int {
  t / 1_000_000_000
}

fn nanosecond(t: Time) -> Int {
  t % 1_000_000_000
}

fn validate_timestamp(ts_opt: Option<Timestamp>) -> Bool {
  expect Some(ts) = ts_opt
  expect ts.seconds >= min_valid_seconds
  expect ts.seconds < max_valid_seconds
  expect ts.nanos >= 0 && ts.nanos <= 1_000_000_000
  True
}

pub fn encode_varint_timestamp(v: Int) -> ByteArray {
  ite(
    v >= ( 1 |> shl(7) ),
    v
      |> shr(7)
      |> encode_varint_timestamp()
      |> push(
           v
             |> band(0x7f)
             |> bor(0x80),
         ),
    #[] |> push(v),
  )
}
