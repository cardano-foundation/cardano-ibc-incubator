pub type MintVoucherRedeemer {
  MintVoucher {
    packet_source_port: ByteArray,
    packet_source_channel: ByteArray,
    packet_dest_port: ByteArray,
    packet_dest_channel: ByteArray,
  }
  BurnVoucher {
    packet_source_port: ByteArray,
    packet_source_channel: ByteArray,
  }
  RefundVoucher {
    packet_source_port: ByteArray,
    packet_source_channel: ByteArray,
  }
}
