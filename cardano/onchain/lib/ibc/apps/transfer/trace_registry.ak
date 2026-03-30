use aiken/primitive/bytearray

// A single registry entry is the canonical reversible mapping for one Cardano
// voucher asset name. `voucher_hash` is the voucher token name bytes, and
// `full_denom` is the exact ICS-20 trace string whose sha3-256 hash produced it.
pub type TraceRegistryEntry {
  voucher_hash: ByteArray,
  full_denom: ByteArray,
}

// Each shard carries only the hashes assigned to its first-four-bits bucket. Sharding is
// purely a contention / datum-size control mechanism; it does not change the
// logical meaning of the mapping.
pub type TraceRegistryShardDatum {
  shard_index: Int,
  entries: List<TraceRegistryEntry>,
}

pub type TraceRegistryRedeemer {
  InsertTrace {
    voucher_hash: ByteArray,
    full_denom: ByteArray,
  }
}

// The first four bits of the voucher hash pick the owning shard, so any client can
// derive the registry location from the Cardano asset id alone.
pub fn shard_index_for_hash(voucher_hash: ByteArray) -> Int {
  expect bytearray.length(voucher_hash) > 0
  bytearray.at(voucher_hash, 0) / 16
}
