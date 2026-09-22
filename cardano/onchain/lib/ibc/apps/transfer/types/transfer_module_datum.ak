pub type TransferModuleDatum {
  escrow_shard_registry_root: ByteArray,
  outstanding_voucher_obligation: Int,
}

pub const empty_escrow_shard_registry_root =
  #"0000000000000000000000000000000000000000000000000000000000000000"
