use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}

pub type TransferModuleRedeemer {
  Transfer { channel_id: ByteArray, data: FungibleTokenPacketData }
  OtherTransferOp
}
