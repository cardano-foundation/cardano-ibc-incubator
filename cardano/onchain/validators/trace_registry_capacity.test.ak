use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{from_script}
use cardano/assets.{PolicyId, Value, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use ibc/apps/transfer/trace_registry.{
  Directory, InsertTrace, Shard, TraceRegistryDatum,
  TraceRegistryDirectoryBucket, TraceRegistryDirectoryDatum, TraceRegistryEntry,
  TraceRegistryRedeemer, TraceRegistryShardDatum, bucket_index_for_hash,
  directory_bucket_is_within_capacity, full_denom_is_within_limits,
  max_entries_per_shard, max_full_denom_bytes, shard_is_within_capacity,
}
use ibc/apps/transfer/voucher_asset_name
use ibc/auth.{AuthToken}
use trace_registry as trace_registry_validator

fn test_shard_policy_id() -> PolicyId {
  "trace shard policy"
}

fn test_directory_auth_token() -> AuthToken {
  AuthToken { policy_id: test_shard_policy_id(), name: "dir" }
}

fn test_voucher_policy_id() -> PolicyId {
  "voucher mint policy"
}

fn test_registry_address() {
  from_script("trace registry script hash")
}

fn test_output_ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: index,
  }
}

fn test_shard_output(
  bucket_index: Int,
  shard_name: ByteArray,
  entries: List<TraceRegistryEntry>,
) -> Output {
  Output {
    address: test_registry_address(),
    value: from_asset(test_shard_policy_id(), shard_name, 1),
    datum: InlineDatum(Shard(TraceRegistryShardDatum { bucket_index, entries })),
    reference_script: None,
  }
}

fn decoy_entry() -> TraceRegistryEntry {
  TraceRegistryEntry {
    voucher_hash: #"11111111111111111111111111111111111111111111111111111111",
    full_denom: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  }
}

fn short_decoy_entry() -> TraceRegistryEntry {
  TraceRegistryEntry {
    voucher_hash: #"11111111111111111111111111111111111111111111111111111111",
    full_denom: "u",
  }
}

fn archived_names() -> List<ByteArray> {
  [
    "archive-0", "archive-1", "archive-2", "archive-3", "archive-4", "archive-5",
    "archive-6", "archive-7",
  ]
}

fn archived_inputs(
  bucket_index: Int,
  entries_per_shard: Int,
  entry: TraceRegistryEntry,
) -> List<Input> {
  archived_names()
    |> list.indexed_map(
        fn(index, name) {
          Input {
            output_reference: test_output_ref(index + 2),
            output: test_shard_output(
              bucket_index,
              name,
              list.repeat(entry, entries_per_shard),
            ),
          }
        },
      )
}

fn run_boundary_append(
  entries_per_shard: Int,
  decoy: TraceRegistryEntry,
) -> Bool {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let active_shard_name = "active"
  let old_entries = list.repeat(decoy, entries_per_shard - 1)
  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, active_shard_name, old_entries),
    }
  let directory_input =
    Input {
      output_reference: test_output_ref(1),
      output: Output {
        address: test_registry_address(),
        value: from_asset(
          test_directory_auth_token().policy_id,
          test_directory_auth_token().name,
          1,
        ),
        datum: InlineDatum(
          Directory(
            TraceRegistryDirectoryDatum {
              buckets: [
                TraceRegistryDirectoryBucket {
                  bucket_index,
                  active_shard_name,
                  archived_shard_names: archived_names(),
                },
              ],
            },
          ),
        ),
        reference_script: None,
      },
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      active_shard_name,
      list.concat(old_entries, [expected_entry]),
    )
  let mint: Value =
    from_asset(
      test_voucher_policy_id(),
      voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
      1,
    )
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [
        directory_input,
        ..archived_inputs(bucket_index, entries_per_shard, decoy)
      ],
      outputs: [updated_output],
      mint,
    }

  trace_registry_validator.spend_trace_registry.spend(
    test_shard_policy_id(),
    test_directory_auth_token(),
    test_voucher_policy_id(),
    "",
    Some(Shard(TraceRegistryShardDatum { bucket_index, entries: old_entries })),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_boundary_append_eight_archives_at_entry_limit() {
  run_boundary_append(max_entries_per_shard, short_decoy_entry())
}

test trace_registry_boundary_append_eight_archives_near_byte_limit() {
  run_boundary_append(10, decoy_entry())
}

test trace_registry_capacity_accepts_exact_entry_and_denom_limits() {
  and {
    bytearray.length(decoy_entry().full_denom) == max_full_denom_bytes,
    full_denom_is_within_limits(decoy_entry().full_denom),
    shard_is_within_capacity(
      TraceRegistryShardDatum {
        bucket_index: 0,
        entries: list.repeat(short_decoy_entry(), max_entries_per_shard),
      },
    ),
  }
}

test trace_registry_capacity_rejects_oversized_denom_and_shard() {
  and {
    !full_denom_is_within_limits(
      bytearray.concat(decoy_entry().full_denom, "x"),
    ),
    !shard_is_within_capacity(
      TraceRegistryShardDatum {
        bucket_index: 0,
        entries: list.repeat(short_decoy_entry(), max_entries_per_shard + 1),
      },
    ),
    !shard_is_within_capacity(
      TraceRegistryShardDatum {
        bucket_index: 0,
        entries: list.repeat(decoy_entry(), 11),
      },
    ),
  }
}

test trace_registry_capacity_rejects_ninth_archive_and_ninth_hop() {
  and {
    !directory_bucket_is_within_capacity(
      TraceRegistryDirectoryBucket {
        bucket_index: 0,
        active_shard_name: "active",
        archived_shard_names: [
          "archive-0", "archive-1", "archive-2", "archive-3", "archive-4",
          "archive-5", "archive-6", "archive-7", "archive-8",
        ],
      },
    ),
    !full_denom_is_within_limits(
      "transfer/channel-0/transfer/channel-1/transfer/channel-2/transfer/channel-3/transfer/channel-4/transfer/channel-5/transfer/channel-6/transfer/channel-7/transfer/channel-8/uatom",
    ),
  }
}
