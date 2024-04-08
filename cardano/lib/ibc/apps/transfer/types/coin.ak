use aiken/bytearray

pub fn sender_chain_is_source(
  source_port: ByteArray,
  source_channel: ByteArray,
  denom: ByteArray,
) -> Bool {
  !receiver_chain_is_source(source_port, source_channel, denom)
}

pub fn receiver_chain_is_source(
  source_port: ByteArray,
  source_channel: ByteArray,
  denom: ByteArray,
) -> Bool {
  let voucher_prefix = get_denom_prefix(source_port, source_channel)

  let denom_prefix =
    bytearray.length(voucher_prefix) |> bytearray.take(denom, _)

  denom_prefix == voucher_prefix
}

pub fn get_denom_prefix(port_id: ByteArray, channel_id: ByteArray) -> ByteArray {
  bytearray.concat(port_id, "/")
    |> bytearray.concat(channel_id)
    |> bytearray.concat("/")
}
