use aiken/cbor
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/apps/transfer/voucher_asset_name
use ibc/apps/transfer/voucher_metadata.{DenomTrace, split_full_denom_trace}
use ibc/utils/string as string_utils

// These are protocol limits, not relayer tuning knobs. Keep the mirrored
// constants in the Gateway's `shared/types/trace-registry.ts` aligned when
// changing them.
pub const bucket_count = 16

pub const max_full_denom_bytes = 256

pub const max_trace_hops = 8

pub const max_entries_per_shard = 32

pub const max_shard_datum_bytes = 3_072

pub const max_archived_shards_per_bucket = 8

pub const max_directory_datum_bytes = 6_144

const max_asset_name_bytes = 32

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
// each bucket. Up to eight older shard token names remain discoverable through
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
  InsertTrace { voucher_hash: ByteArray, full_denom: ByteArray }
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

pub fn full_denom_is_within_limits(full_denom: ByteArray) -> Bool {
  let full_denom_bytes = bytearray.length(full_denom)

  if full_denom_bytes == 0 || full_denom_bytes > max_full_denom_bytes {
    False
  } else {
    let DenomTrace { path, .. } = split_full_denom_trace(full_denom)
    let trace_hops =
      if path == "" {
        0
      } else {
        list.length(string_utils.split(path, string_utils.slash_char)) / 2
      }

    trace_hops <= max_trace_hops
  }
}

pub fn entry_is_admissible(entry: TraceRegistryEntry) -> Bool {
  and {
    bytearray.length(entry.voucher_hash) == voucher_asset_name.voucher_denom_hash_length,
    full_denom_is_within_limits(entry.full_denom),
    voucher_asset_name.voucher_denom_hash(entry.full_denom) == entry.voucher_hash,
  }
}

pub fn shard_is_within_capacity(shard: TraceRegistryShardDatum) -> Bool {
  and {
    shard.bucket_index >= 0,
    shard.bucket_index < bucket_count,
    list.length(shard.entries) <= max_entries_per_shard,
    bytearray.length(cbor.serialise(Shard(shard))) <= max_shard_datum_bytes,
  }
}

pub fn directory_bucket_is_within_capacity(
  bucket: TraceRegistryDirectoryBucket,
) -> Bool {
  let archived_names = bucket.archived_shard_names

  and {
    bucket.bucket_index >= 0,
    bucket.bucket_index < bucket_count,
    valid_shard_name(bucket.active_shard_name),
    list.length(archived_names) <= max_archived_shards_per_bucket,
    list.all(archived_names, valid_shard_name),
    !list.has(archived_names, bucket.active_shard_name),
    bytearrays_are_unique(archived_names),
  }
}

pub fn directory_is_within_capacity(
  directory: TraceRegistryDirectoryDatum,
) -> Bool {
  and {
    list.length(directory.buckets) <= bucket_count,
    bytearray.length(cbor.serialise(Directory(directory))) <= max_directory_datum_bytes,
    list.all(directory.buckets, directory_bucket_is_within_capacity),
    bucket_indices_are_unique(directory.buckets),
  }
}

fn valid_shard_name(name: ByteArray) -> Bool {
  let length = bytearray.length(name)
  length > 0 && length <= max_asset_name_bytes
}

fn bytearrays_are_unique(values: List<ByteArray>) -> Bool {
  when values is {
    [] -> True
    [value, ..rest] -> !list.has(rest, value) && bytearrays_are_unique(rest)
  }
}

fn bucket_indices_are_unique(
  buckets: List<TraceRegistryDirectoryBucket>,
) -> Bool {
  when buckets is {
    [] -> True
    [bucket, ..rest] ->
      list.find(
        rest,
        fn(candidate) { candidate.bucket_index == bucket.bucket_index },
      ) == None && bucket_indices_are_unique(rest)
  }
}
