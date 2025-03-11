// DO NOT EDIT.
// source: google/protobuf/timestamp.proto

use aiken/builtin.{if_then_else as ite}
use ibc/utils/bytes.{add_and_concat, encode_int}
use ibc/utils/int.{Int32, Int64}
use ibc/utils/time.{Time}

const min_valid_seconds = -62135596800

const max_valid_seconds = 253402300800

pub type Timestamp {
  seconds: Int64,
  nanos: Int32,
}

pub fn marshal_for_timestamp(ts: Timestamp) -> (Int, ByteArray) {
  let Timestamp { seconds, nanos } = ts
  (0, #[])
    |> add_and_concat(encode_int(seconds, 8))
    |> add_and_concat(encode_int(nanos, 0x10))
}

pub fn timestamp_proto(t: Time) -> Option<Timestamp> {
  let ts = Timestamp { seconds: second(t), nanos: nanosecond(t) }
  ite(validate_timestamp(ts), Some(ts), None)
}

fn second(t: Time) -> Int {
  t / 1_000_000_000
}

fn nanosecond(t: Time) -> Int {
  t % 1_000_000_000
}

fn validate_timestamp(ts: Timestamp) -> Bool {
  and {
    ts.seconds >= min_valid_seconds,
    ts.seconds < max_valid_seconds,
    ts.nanos >= 0 && ts.nanos <= 1_000_000_000,
  }
}
