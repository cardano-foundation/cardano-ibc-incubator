use aiken/crypto.{Blake2b_224, Hash, Script}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}

pub type MintPortRedeemer {
  // Module lifecycle setup.
  BindPort {
    handler_token: AuthToken,
    spend_module_script_hash: Hash<Blake2b_224, Script>,
    port_number: Int,
  }
  // First native send for a `{channel_id, denom}` escrow shard.
  CreateEscrowShard {
    channel_id: ByteArray,
    denom: ByteArray,
    data: FungibleTokenPacketData,
  }
  // Final native unescrow/refund for an emptied shard.
  BurnEscrowShard { channel_id: ByteArray, denom: ByteArray }
}
