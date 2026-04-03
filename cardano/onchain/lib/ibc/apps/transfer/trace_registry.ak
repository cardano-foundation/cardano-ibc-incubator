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
  bucket_index: Int,
  entries: List<TraceRegistryEntry>,
}

// The directory is the source of truth for which shard is currently writable for
// each bucket. Older shard token names remain discoverable through
// `archived_shard_names`, so lookups do not lose history after a rollover.
pub type TraceRegistryDirectoryBucket {
  bucket_index: Int,
  active_shard_name: ByteArray,
  archived_shard_names: List<ByteArray>,
}

pub type TraceRegistryDirectoryDatum {
  buckets: List<TraceRegistryDirectoryBucket>,
}

pub type TraceRegistryDatum {
  Shard(TraceRegistryShardDatum)
  Directory(TraceRegistryDirectoryDatum)
}

pub type TraceRegistryRedeemer {
  InsertTrace {
    voucher_hash: ByteArray,
    full_denom: ByteArray,
  }
  RolloverInsertTrace {
    voucher_hash: ByteArray,
    full_denom: ByteArray,
    new_active_shard_name: ByteArray,
  }
  AdvanceDirectory {
    bucket_index: Int,
    voucher_hash: ByteArray,
    full_denom: ByteArray,
    previous_active_shard_name: ByteArray,
    new_active_shard_name: ByteArray,
  }
}

// The first four bits of the voucher hash pick the owning shard, so any client can
// derive the registry location from the Cardano asset id alone.
pub fn bucket_index_for_hash(voucher_hash: ByteArray) -> Int {
  expect bytearray.length(voucher_hash) > 0
  bytearray.at(voucher_hash, 0) / 16
}
