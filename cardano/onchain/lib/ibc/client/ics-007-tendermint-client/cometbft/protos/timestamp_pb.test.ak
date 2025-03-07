use ibc/client/ics_007_tendermint_client/cometbft/protos/timestamp_pb.{
  Timestamp, marshal_for_timestamp, marshal_for_timestamp_v2, size_for_timestamp,
}

test test_marshal_for_timestamp_same_results_zero() {
  let timestamp = Timestamp(0, 0)
  let (length, bytes) = marshal_for_timestamp_v2(timestamp)
  let bytes_deprecated = marshal_for_timestamp(Some(timestamp))
  let length_deprecated = size_for_timestamp(Some(timestamp))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_timestamp_same_results() {
  let timestamp = Timestamp(1741257890, 0)
  let (length, bytes) = marshal_for_timestamp_v2(timestamp)
  let bytes_deprecated = marshal_for_timestamp(Some(timestamp))
  let length_deprecated = size_for_timestamp(Some(timestamp))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}

test test_marshal_for_timestamp_same_results_with_millis() {
  let timestamp = Timestamp(1741257890, 1234)
  let (length, bytes) = marshal_for_timestamp_v2(timestamp)
  let bytes_deprecated = marshal_for_timestamp(Some(timestamp))
  let length_deprecated = size_for_timestamp(Some(timestamp))
  and {
    length == length_deprecated,
    bytes == bytes_deprecated,
  }
}
