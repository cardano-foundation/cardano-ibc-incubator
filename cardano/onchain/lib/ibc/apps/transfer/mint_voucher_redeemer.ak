use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/core/ics_004/types/acknowledgement.{Acknowledgement}

pub type MintVoucherRedeemer {
  MintVoucher {
    packet_source_port: ByteArray,
    packet_source_channel: ByteArray,
    packet_dest_port: ByteArray,
    packet_dest_channel: ByteArray,
    data: FungibleTokenPacketData,
  }
  BurnVoucher {
    packet_source_port: ByteArray,
    packet_source_channel: ByteArray,
    data: FungibleTokenPacketData,
  }
  RefundVoucher {
    packet_source_port: ByteArray,
    packet_source_channel: ByteArray,
    data: FungibleTokenPacketData,
    acknowledgement: Option<Acknowledgement>,
  }
}
