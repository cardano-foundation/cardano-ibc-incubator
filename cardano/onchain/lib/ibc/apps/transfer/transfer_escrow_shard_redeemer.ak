use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}

pub type TransferEscrowShardRedeemer {
  // First native send for a `{channel_id, denom}` escrow shard.
  CreateEscrowShard {
    channel_id: ByteArray,
    denom: ByteArray,
    data: FungibleTokenPacketData,
  }
  // Final native unescrow/refund for an emptied shard.
  BurnEscrowShard { channel_id: ByteArray, denom: ByteArray }
}
