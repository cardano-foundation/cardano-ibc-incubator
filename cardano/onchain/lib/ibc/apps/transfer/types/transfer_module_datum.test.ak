use ibc/apps/transfer/types/transfer_module_datum

test empty_transfer_module_datum_initializes_lifecycle_accounting() {
  let datum = transfer_module_datum.empty_transfer_module_datum()
  and {
    datum.escrow_shard_registry_root == transfer_module_datum.empty_escrow_shard_registry_root,
    datum.live_escrow_shard_count == 0,
    datum.voucher_supply == 0,
  }
}
