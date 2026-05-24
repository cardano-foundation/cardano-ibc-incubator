use aiken/fuzz
use cardano/address.{from_script}
use cardano/assets.{PolicyId, Value, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use ibc/apps/transfer/bridge_registry.{BridgeDeployment, BridgeRegistryDatum}
use ibc/apps/transfer/trace_registry.{
  Directory, InsertTrace, Shard, TraceRegistryDatum,
  TraceRegistryDirectoryBucket, TraceRegistryDirectoryDatum, TraceRegistryEntry,
  TraceRegistryRedeemer, TraceRegistryShardDatum, bucket_index_for_hash,
}
use ibc/apps/transfer/voucher_asset_name
use ibc/auth.{AuthToken}
use ibc/testing/fuzz_dsl
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

fn test_bridge_registry_token() -> AuthToken {
  AuthToken {
    policy_id: "bridge registry policy",
    name: "bridge registry token",
  }
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

fn test_bridge_registry_input() -> Input {
  test_bridge_registry_input_with_active(test_voucher_policy_id())
}

fn test_bridge_registry_input_with_active(
  active_voucher_policy_id: PolicyId,
) -> Input {
  let token = test_bridge_registry_token()

  Input {
    output_reference: test_output_ref(99),
    output: Output {
      address: from_script("bridge registry script hash"),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(
        BridgeRegistryDatum {
          active_deployment: BridgeDeployment {
            host_state_nft_policy_id: "host state policy",
            channel_minting_policy_id: "channel policy",
          },
          active_voucher_policy_id,
          legacy_voucher_policy_ids: [],
          governance_key_hash: #"00000000000000000000000000000000000000000000000000000000",
        },
      ),
      reference_script: None,
    },
  }
}

fn with_bridge_registry_active(
  transaction: Transaction,
  active_voucher_policy_id: PolicyId,
) -> Transaction {
  Transaction {
    ..transaction,
    reference_inputs: [
      test_bridge_registry_input_with_active(active_voucher_policy_id),
      ..transaction.reference_inputs
    ],
  }
}

fn with_bridge_registry(transaction: Transaction) -> Transaction {
  with_bridge_registry_active(transaction, test_voucher_policy_id())
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
    test_bridge_registry_token(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(datum),
    redeemer,
    spent_output_ref,
    with_bridge_registry(transaction),
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
    test_bridge_registry_token(),
    benchmark_policy_id,
    Some(datum),
    redeemer,
    spent_output_ref,
    with_bridge_registry(transaction),
  )
}

fn run_trace_registry_spend_with_active_voucher(
  datum: TraceRegistryDatum,
  redeemer: TraceRegistryRedeemer,
  spent_output_ref: OutputReference,
  transaction: Transaction,
  active_voucher_policy_id: PolicyId,
) -> Bool {
  trace_registry_validator.spend_trace_registry.spend(
    test_shard_policy_id(),
    test_directory_auth_token(),
    test_bridge_registry_token(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(datum),
    redeemer,
    spent_output_ref,
    with_bridge_registry_active(transaction, active_voucher_policy_id),
  )
}

type TestInsertFixture {
  full_denom: ByteArray,
  voucher_hash: ByteArray,
  bucket_index: Int,
  wrong_bucket_index: Int,
  shard_name: ByteArray,
  archived_shard_name: ByteArray,
  existing_entry: TraceRegistryEntry,
  spent_input: Input,
  directory_input: Input,
  archived_shard_reference_input: Input,
  updated_output: Output,
  valid_mint: Value,
}

fn choose_insert_full_denom(seed: Int) -> ByteArray {
  if seed % 3 == 0 {
    "transfer/channel-7/uatom"
  } else if seed % 3 == 1 {
    "transfer/channel-22/uosmo"
  } else {
    "transfer/channel-144/factory/osmo1abcd/token"
  }
}

fn test_insert_fixture(seed: Int) -> TestInsertFixture {
  let full_denom = choose_insert_full_denom(seed)
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let wrong_bucket_index = ( bucket_index + 1 ) % 16
  let shard_name = "active-0a"
  let archived_shard_name = "archived-0a"
  let existing_entry = test_expected_entry(full_denom)
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])
  let archived_shard_reference_input =
    Input {
      output_reference: test_output_ref(2),
      output: test_shard_output(
        bucket_index,
        archived_shard_name,
        [existing_entry],
      ),
    }
  let updated_output =
    test_shard_output(bucket_index, shard_name, [existing_entry])
  let valid_mint =
    from_asset(
      test_voucher_policy_id(),
      voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
      1,
    )

  TestInsertFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    wrong_bucket_index,
    shard_name,
    archived_shard_name,
    existing_entry,
    spent_input,
    directory_input,
    archived_shard_reference_input,
    updated_output,
    valid_mint,
  }
}

fn test_insert_transaction(
  spent_input: Input,
  reference_inputs: List<Input>,
  updated_output: Output,
  mint: Value,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [spent_input],
    reference_inputs,
    outputs: [updated_output],
    mint,
  }
}

test prop_trace_registry_append_accepts_active_shard_insert(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.trace.append.valid")

  // Happy path: spend the active shard for the hash bucket, append exactly one
  // canonical trace entry, and mint the matching voucher.
  let fixture = test_insert_fixture(seed)
  let TestInsertFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    spent_input,
    directory_input,
    updated_output,
    valid_mint,
    ..
  } = fixture

  fuzz_dsl.valid_check(
    "trace",
    "append",
    "run_trace_registry_spend",
    run_trace_registry_spend(
      Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
      InsertTrace { voucher_hash, full_denom },
      test_output_ref(0),
      test_insert_transaction(
        spent_input,
        [directory_input],
        updated_output,
        valid_mint,
      ),
    ),
  )
    |> fuzz_dsl.assert_valid
}

test trace_registry_insert_uses_active_voucher_from_bridge_registry() {
  let active_v2_voucher_policy_id = "voucher mint policy v2"
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let valid_v2_mint =
    from_asset(
      active_v2_voucher_policy_id,
      voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
      1,
    )

  run_trace_registry_spend_with_active_voucher(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input],
      updated_output,
      valid_v2_mint,
    ),
    active_v2_voucher_policy_id,
  )
}

test trace_registry_insert_rejects_inactive_voucher_after_upgrade() fail {
  let active_v2_voucher_policy_id = "voucher mint policy v2"
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let shard_name = "active-0a"
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, shard_name, []),
    }
  let directory_input = test_directory_input(1, bucket_index, shard_name, [])
  let updated_output =
    test_shard_output(
      bucket_index,
      shard_name,
      [test_expected_entry(full_denom)],
    )
  let stale_v1_mint =
    from_asset(
      test_voucher_policy_id(),
      voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
      1,
    )

  run_trace_registry_spend_with_active_voucher(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input],
      updated_output,
      stale_v1_mint,
    ),
    active_v2_voucher_policy_id,
  )
}

test prop_trace_registry_append_rejects_without_matching_voucher_mint(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.append.invalid_missing_voucher_mint")

  // Trace registry append is coupled to voucher minting. Without the matching
  // voucher asset, a registry entry would let metadata claim unbacked supply.
  let fixture = test_insert_fixture(seed)
  let TestInsertFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    spent_input,
    directory_input,
    updated_output,
    ..
  } = fixture

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input],
      updated_output,
      from_asset(test_voucher_policy_id(), "some-other-voucher", 1),
    ),
  )
}

test prop_trace_registry_append_rejects_wrong_bucket(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.trace.append.invalid_wrong_bucket")

  // The entry is otherwise well-formed but placed in the wrong bucket. This
  // protects lookup determinism for full-denom hash routing.
  let fixture = test_insert_fixture(seed)
  let TestInsertFixture {
    full_denom,
    voucher_hash,
    wrong_bucket_index,
    shard_name,
    valid_mint,
    ..
  } = fixture
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

  run_trace_registry_spend(
    Shard(
      TraceRegistryShardDatum { bucket_index: wrong_bucket_index, entries: [] },
    ),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input],
      updated_output,
      valid_mint,
    ),
  )
}

test prop_trace_registry_append_rejects_duplicate_active_hash(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.append.invalid_duplicate_active_hash")

  // Active-shard duplicate detection must reject the same full-denom hash even
  // when the appended entry is canonical.
  let fixture = test_insert_fixture(seed)
  let TestInsertFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    shard_name,
    existing_entry,
    directory_input,
    valid_mint,
    ..
  } = fixture
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

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [existing_entry] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input],
      updated_output,
      valid_mint,
    ),
  )
}

test prop_trace_registry_append_rejects_duplicate_archived_hash(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.append.invalid_duplicate_archived_hash")

  // Archived shards are immutable lookup history, but they still participate in
  // duplicate detection for newly appended traces.
  let fixture = test_insert_fixture(seed)
  let TestInsertFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    shard_name,
    archived_shard_name,
    spent_input,
    archived_shard_reference_input,
    updated_output,
    valid_mint,
    ..
  } = fixture
  let directory_input =
    test_directory_input(1, bucket_index, shard_name, [archived_shard_name])

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input, archived_shard_reference_input],
      updated_output,
      valid_mint,
    ),
  )
}

test prop_trace_registry_append_rejects_inactive_shard(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.trace.append.invalid_inactive_shard")

  // Only the directory's active shard can be spent for append. Spending an
  // archived shard would allow mutation of finalized registry history.
  let fixture = test_insert_fixture(seed)
  let TestInsertFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    shard_name,
    archived_shard_name,
    updated_output,
    valid_mint,
    ..
  } = fixture
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, archived_shard_name, []),
    }
  let directory_input =
    test_directory_input(1, bucket_index, shard_name, [archived_shard_name])

  run_trace_registry_spend(
    Shard(TraceRegistryShardDatum { bucket_index, entries: [] }),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    test_insert_transaction(
      spent_input,
      [directory_input],
      updated_output,
      valid_mint,
    ),
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
