use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}

pub type TransferEscrowShardRedeemer {
  // Legacy constructor retained at index 0 for ABI decoding only. Fresh
  // policies reject it in favour of CreateEscrowShardV2.
  CreateEscrowShard {
    channel_id: ByteArray,
    denom: ByteArray,
    data: FungibleTokenPacketData,
    registry_siblings: List<ByteArray>,
  }
  // First native send for a `{channel_id, denom}` escrow shard, updating both
  // its lifecycle marker and the authenticated per-channel live-shard count.
  CreateEscrowShardV2 {
    channel_id: ByteArray,
    denom: ByteArray,
    data: FungibleTokenPacketData,
    registry_siblings: List<ByteArray>,
    old_channel_live_escrow_shard_count: Int,
    channel_live_escrow_shard_count_siblings: List<ByteArray>,
  }
  // Reclaim a zero-principal shard, retaining its registry tombstone so the
  // deterministic NFT can never be minted again.
  RetireEscrowShard {
    channel_id: ByteArray,
    denom: ByteArray,
    registry_siblings: List<ByteArray>,
    old_channel_live_escrow_shard_count: Int,
    channel_live_escrow_shard_count_siblings: List<ByteArray>,
    transfer_port_token: AuthToken,
  }
}
