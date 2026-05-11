use cardano/address.{from_script}
use cardano/assets.{PolicyId, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use ibc/apps/transfer/trace_registry.{
  Directory, InsertTrace, Shard, TraceRegistryDatum,
  TraceRegistryDirectoryBucket, TraceRegistryDirectoryDatum, TraceRegistryEntry,
  TraceRegistryRedeemer, TraceRegistryShardDatum, bucket_index_for_hash,
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

fn test_benchmark_voucher_policy_id() -> PolicyId {
  "benchmark voucher mint policy"
}

fn test_disabled_benchmark_voucher_policy_id() -> PolicyId {
  ""
}

fn test_registry_address() {
  from_script("trace registry script hash")
}

fn test_other_registry_address() {
  from_script("different trace registry script hash")
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

fn test_directory_output(buckets: List<TraceRegistryDirectoryBucket>) -> Output {
  test_directory_output_with_token_name("dir", buckets)
}

fn test_directory_output_with_token_name(
  token_name: ByteArray,
  buckets: List<TraceRegistryDirectoryBucket>,
) -> Output {
  test_directory_output_at_address(test_registry_address(), token_name, buckets)
}

fn test_directory_output_at_address(
  address,
  token_name: ByteArray,
  buckets: List<TraceRegistryDirectoryBucket>,
) -> Output {
  Output {
    address,
    value: from_asset(test_shard_policy_id(), token_name, 1),
    datum: InlineDatum(Directory(TraceRegistryDirectoryDatum { buckets })),
    reference_script: None,
  }
}

fn test_directory_input(
  output_index: Int,
  bucket_index: Int,
  active_shard_name: ByteArray,
  archived_shard_names: List<ByteArray>,
) -> Input {
  Input {
    output_reference: test_output_ref(output_index),
    output: test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name,
          archived_shard_names,
        },
      ],
    ),
  }
}

fn test_non_registry_reference_input(output_index: Int) -> Input {
  Input {
    output_reference: test_output_ref(output_index),
    output: Output {
      address: test_registry_address(),
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(Void),
      reference_script: None,
    },
  }
}

fn test_expected_entry(full_denom: ByteArray) -> TraceRegistryEntry {
  TraceRegistryEntry {
    voucher_hash: voucher_asset_name.voucher_denom_hash(full_denom),
    full_denom,
  }
}

fn run_trace_registry_spend(
  datum: TraceRegistryDatum,
  redeemer: TraceRegistryRedeemer,
  spent_output_ref: OutputReference,
  transaction: Transaction,
) -> Bool {
  trace_registry_validator.spend_trace_registry.spend(
    test_shard_policy_id(),
    test_directory_auth_token(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(datum),
    redeemer,
    spent_output_ref,
    transaction,
  )
}

fn run_trace_registry_spend_with_benchmark(
  datum: TraceRegistryDatum,
  redeemer: TraceRegistryRedeemer,
  spent_output_ref: OutputReference,
  transaction: Transaction,
  benchmark_policy_id: PolicyId,
) -> Bool {
  trace_registry_validator.spend_trace_registry.spend(
    test_shard_policy_id(),
    test_directory_auth_token(),
    test_voucher_policy_id(),
    benchmark_policy_id,
    Some(datum),
    redeemer,
    spent_output_ref,
    transaction,
  )
}

test trace_registry_insert_trace_succeeds_with_matching_voucher_mint() {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_succeeds_with_matching_benchmark_voucher_mint() {
  let full_denom = "transfer/channel-7/benchmark-uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-bench"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input],
      outputs: [updated_output],
      mint: from_asset(test_benchmark_voucher_policy_id(), voucher_hash, 1),
    }

  run_trace_registry_spend_with_benchmark(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
    test_benchmark_voucher_policy_id(),
  )
}

test trace_registry_insert_trace_succeeds_with_matching_benchmark_voucher_mint_and_extra_reference_inputs() {
  let full_denom = "transfer/channel-7/benchmark-uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-bench"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])
  let helper_ref_1 = test_non_registry_reference_input(2)
  let helper_ref_2 = test_non_registry_reference_input(3)

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [helper_ref_1, helper_ref_2, directory_input],
      outputs: [updated_output],
      mint: from_asset(test_benchmark_voucher_policy_id(), voucher_hash, 1),
    }

  run_trace_registry_spend_with_benchmark(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
    test_benchmark_voucher_policy_id(),
  )
}

test trace_registry_insert_trace_succeeds_with_matching_benchmark_voucher_mint_and_benchmark_sink_output() {
  let full_denom = "transfer/channel-0/benchmark-uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-bench"
  let benchmark_policy_id = test_benchmark_voucher_policy_id()
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])
  let helper_ref_1 = test_non_registry_reference_input(2)
  let helper_ref_2 = test_non_registry_reference_input(3)
  let benchmark_sink_output =
    Output {
      address: test_registry_address(),
      value: assets.from_lovelace(2_000_000)
        |> add(benchmark_policy_id, voucher_hash, 1),
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [helper_ref_1, helper_ref_2, directory_input],
      outputs: [updated_output, benchmark_sink_output],
      mint: from_asset(benchmark_policy_id, voucher_hash, 1),
    }

  run_trace_registry_spend_with_benchmark(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
    benchmark_policy_id,
  )
}

test trace_registry_insert_trace_fails_without_matching_voucher_mint() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input],
      outputs: [updated_output],
      mint: from_asset(test_voucher_policy_id(), "some-other-voucher", 1),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_bucket_does_not_match_hash() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let correct_bucket_index = bucket_index_for_hash(voucher_hash)
  let wrong_bucket_index = ( correct_bucket_index + 1 ) % 16
  let shard_name = "active-wrong"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(wrong_bucket_index, shard_name, []),
    }
  let updated_output =
    test_shard_output(
      wrong_bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let directory_input =
    test_directory_input(1, wrong_bucket_index, shard_name, [])

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(
      TraceRegistryShardDatum { bucket_index: wrong_bucket_index, entries: [] },
    ),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_hash_already_exists() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let existing_entry = test_expected_entry(full_denom)
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, [existing_entry]),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [existing_entry, test_expected_entry(full_denom)],
    )
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [existing_entry] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_hash_exists_in_archived_shard() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let active_shard_name = "active-0a"
  let archived_shard_name = "archived-0a"
  let archived_entry = test_expected_entry(full_denom)
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, active_shard_name, []),
    }
  let directory_input =
    test_directory_input(
      1,
      bucket_index,
      active_shard_name,
      [archived_shard_name],
    )
  let archived_shard_reference_input =
    Input {
      output_reference: test_output_ref(2),
      output: test_shard_output(
        bucket_index,
        archived_shard_name,
        [archived_entry],
      ),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      active_shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input, archived_shard_reference_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_spent_shard_is_not_directory_active() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "archived-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let directory_input =
    test_directory_input(1, bucket_index, "active-0a", [shard_name])
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [directory_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_with_forged_directory_token() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let forged_directory_input =
    Input {
      output_reference: test_output_ref(1),
      output: test_directory_output_with_token_name(
        "forged-dir",
        [
          TraceRegistryDirectoryBucket {
            bucket_index,
            active_shard_name: shard_name,
            archived_shard_names: [],
          },
        ],
      ),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [forged_directory_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_directory_input_is_not_at_registry_address() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let misplaced_directory_input =
    Input {
      output_reference: test_output_ref(1),
      output: test_directory_output_at_address(
        test_other_registry_address(),
        test_directory_auth_token().name,
        [
          TraceRegistryDirectoryBucket {
            bucket_index,
            active_shard_name: shard_name,
            archived_shard_names: [],
          },
        ],
      ),
    }
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      reference_inputs: [misplaced_directory_input],
      outputs: [updated_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      ),
    }

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}
