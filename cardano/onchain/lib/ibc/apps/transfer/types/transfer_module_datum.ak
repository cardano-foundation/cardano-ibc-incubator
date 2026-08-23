pub type TransferModuleDatum {
  escrow_shard_registry_root: ByteArray,
  // Aggregate live application children used by the shutdown drain gate.
  live_escrow_shard_count: Int,
  // Logical outstanding voucher supply across all voucher denominations.
  voucher_supply: Int,
}

pub const empty_escrow_shard_registry_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"

pub fn empty_transfer_module_datum() -> TransferModuleDatum {
  TransferModuleDatum {
    escrow_shard_registry_root: empty_escrow_shard_registry_root,
    live_escrow_shard_count: 0,
    voucher_supply: 0,
  }
}
