use aiken/collection/list
use aiken/fuzz
use cardano/address.{from_script}
use cardano/assets.{PolicyId, Value, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use ibc/apps/transfer/trace_registry.{
  AdvanceDirectory, Directory, RolloverInsertTrace, Shard, TraceRegistryDatum,
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

fn test_disabled_benchmark_voucher_policy_id() -> PolicyId {
  ""
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

type TestRolloverFixture {
  full_denom: ByteArray,
  voucher_hash: ByteArray,
  bucket_index: Int,
  previous_active_shard_name: ByteArray,
  new_active_shard_name: ByteArray,
  old_entry: TraceRegistryEntry,
  old_shard: TraceRegistryShardDatum,
  old_directory: TraceRegistryDirectoryDatum,
  updated_directory: TraceRegistryDirectoryDatum,
  spent_shard_input: Input,
  spent_directory_input: Input,
  archived_output: Output,
  new_active_output: Output,
  updated_directory_output: Output,
  mint: Value,
}

type TraceRegistryModel {
  TraceRegistryModel {
    directory: TraceRegistryDirectoryDatum,
    active_shard: TraceRegistryShardDatum,
    archived_shards: List<TraceRegistryShardDatum>,
  }
}

fn normalize_non_target_offset(seed: Int) -> Int {
  1 + if seed < 0 {
    ( 0 - seed ) % 15
  } else {
    seed % 15
  }
}

fn test_noise_bucket(bucket_index: Int) -> TraceRegistryDirectoryBucket {
  TraceRegistryDirectoryBucket {
    bucket_index,
    active_shard_name: "noise-active",
    archived_shard_names: ["noise-archived"],
  }
}

// Build the smallest valid rollover shape we care about fuzzing:
// one target bucket changes active shard, and one non-target bucket remains
// byte-for-byte unchanged so mutations can prove the validator rejects drift.
fn test_rollover_fixture(extra_bucket_seed: Int) -> TestRolloverFixture {
  let full_denom = "transfer/channel-77/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_entry =
    TraceRegistryEntry {
      voucher_hash: voucher_asset_name.voucher_denom_hash(
        "transfer/channel-7/uosmo",
      ),
      full_denom: "transfer/channel-7/uosmo",
    }
  let old_shard = TraceRegistryShardDatum { bucket_index, entries: [old_entry] }
  let non_target_bucket_index =
    ( bucket_index + normalize_non_target_offset(extra_bucket_seed) ) % 16
  let old_directory =
    TraceRegistryDirectoryDatum {
      buckets: [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: previous_active_shard_name,
          archived_shard_names: [],
        },
        test_noise_bucket(non_target_bucket_index),
      ],
    }
  let updated_directory =
    TraceRegistryDirectoryDatum {
      buckets: [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [previous_active_shard_name],
        },
        test_noise_bucket(non_target_bucket_index),
      ],
    }
  let spent_shard_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(
        bucket_index,
        previous_active_shard_name,
        old_shard.entries,
      ),
    }
  let spent_directory_input =
    Input {
      output_reference: test_output_ref(1),
      output: test_directory_output(old_directory.buckets),
    }
  let archived_output =
    test_shard_output(
      bucket_index,
      previous_active_shard_name,
      old_shard.entries,
    )
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )
  let updated_directory_output =
    test_directory_output(updated_directory.buckets)
  let mint =
    from_asset(
      test_voucher_policy_id(),
      voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
      1,
    )
      |> add(test_shard_policy_id(), new_active_shard_name, 1)

  TestRolloverFixture {
    full_denom,
    voucher_hash,
    bucket_index,
    previous_active_shard_name,
    new_active_shard_name,
    old_entry,
    old_shard,
    old_directory,
    updated_directory,
    spent_shard_input,
    spent_directory_input,
    archived_output,
    new_active_output,
    updated_directory_output,
    mint,
  }
}

fn trace_model(
  directory: TraceRegistryDirectoryDatum,
  active_shard: TraceRegistryShardDatum,
) -> TraceRegistryModel {
  TraceRegistryModel { directory, active_shard, archived_shards: [] }
}

fn model_append_trace(
  model: TraceRegistryModel,
  entry: TraceRegistryEntry,
) -> TraceRegistryModel {
  TraceRegistryModel {
    ..model,
    active_shard: TraceRegistryShardDatum {
      ..model.active_shard,
      entries: [entry, ..model.active_shard.entries],
    },
  }
}

fn model_rollover_trace(
  model: TraceRegistryModel,
  updated_directory: TraceRegistryDirectoryDatum,
  new_active_shard: TraceRegistryShardDatum,
) -> TraceRegistryModel {
  TraceRegistryModel {
    directory: updated_directory,
    active_shard: new_active_shard,
    archived_shards: [model.active_shard, ..model.archived_shards],
  }
}

fn shard_has_entry(
  shard: TraceRegistryShardDatum,
  entry: TraceRegistryEntry,
) -> Bool {
  list.any(shard.entries, fn(candidate) { candidate == entry })
}

fn trace_model_has_entry(
  model: TraceRegistryModel,
  entry: TraceRegistryEntry,
) -> Bool {
  or {
    shard_has_entry(model.active_shard, entry),
    list.any(model.archived_shards, fn(shard) { shard_has_entry(shard, entry) }),
  }
}

// The shard-side validator sees both the spent shard and the spent directory,
// so the rollover fixture includes both inputs in the same transaction.
fn test_rollover_shard_transaction(
  fixture: TestRolloverFixture,
  archived_output: Output,
  new_active_output: Output,
  updated_directory_output: Output,
  mint: Value,
) -> Transaction {
  let TestRolloverFixture { spent_shard_input, spent_directory_input, .. } =
    fixture

  Transaction {
    ..placeholder,
    inputs: [spent_shard_input, spent_directory_input],
    outputs: [archived_output, new_active_output, updated_directory_output],
    mint,
  }
}

// The directory-side validator only spends the directory input, but it still
// inspects the archived and new-active shard outputs that the rollover creates.
fn test_rollover_directory_transaction(
  fixture: TestRolloverFixture,
  archived_output: Output,
  new_active_output: Output,
  updated_directory_output: Output,
  mint: Value,
) -> Transaction {
  let TestRolloverFixture { spent_directory_input, .. } = fixture

  Transaction {
    ..placeholder,
    inputs: [spent_directory_input],
    outputs: [updated_directory_output, archived_output, new_active_output],
    mint,
  }
}

// Positive property: a rollover is accepted only when one bucket moves from
// old active -> new active, the old shard is preserved/archived, the new shard
// contains exactly the inserted entry, and the matching voucher mint is present.

test prop_trace_registry_rollover_accepts_exactly_one_bucket_transition(
  extra_bucket_seed via fuzz.int(),
) {
  fuzz.label(@"fuzz.contract.trace.rollover.valid")

  let fixture = test_rollover_fixture(extra_bucket_seed)
  let TestRolloverFixture {
    old_shard,
    old_directory,
    voucher_hash,
    full_denom,
    new_active_shard_name,
    previous_active_shard_name,
    archived_output,
    new_active_output,
    updated_directory_output,
    mint,
    ..
  } = fixture

  fuzz_dsl.valid_check("trace", "rollover", "run_trace_registry_spend", and {
      run_trace_registry_spend(
        Shard(old_shard),
        RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
        test_output_ref(0),
        test_rollover_shard_transaction(
          fixture,
          archived_output,
          new_active_output,
          updated_directory_output,
          mint,
        ),
      ),
      run_trace_registry_spend(
        Directory(old_directory),
        AdvanceDirectory {
          bucket_index: old_shard.bucket_index,
          voucher_hash,
          full_denom,
          previous_active_shard_name,
          new_active_shard_name,
        },
        test_output_ref(1),
        test_rollover_directory_transaction(
          fixture,
          archived_output,
          new_active_output,
          updated_directory_output,
          mint,
        ),
      ),
    })
    |> fuzz_dsl.assert_valid
}

test prop_model_trace_append_rollover_lookup(extra_bucket_seed via fuzz.int()) {
  fuzz.label(@"regression.model.trace.append_rollover_lookup")

  let fixture = test_rollover_fixture(extra_bucket_seed)
  let TestRolloverFixture {
    old_shard,
    old_directory,
    updated_directory,
    old_entry,
    voucher_hash,
    full_denom,
    new_active_shard_name,
    previous_active_shard_name,
    archived_output,
    new_active_output,
    updated_directory_output,
    mint,
    ..
  } = fixture
  let initial_model =
    trace_model(
      old_directory,
      TraceRegistryShardDatum { ..old_shard, entries: [] },
    )
  let appended_model = model_append_trace(initial_model, old_entry)
  let inserted_entry = test_expected_entry(full_denom)
  let rolled_model =
    model_rollover_trace(
      appended_model,
      updated_directory,
      TraceRegistryShardDatum {
        bucket_index: old_shard.bucket_index,
        entries: [inserted_entry],
      },
    )

  and {
    trace_model_has_entry(appended_model, old_entry),
    run_trace_registry_spend(
      Shard(appended_model.active_shard),
      RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
      test_output_ref(0),
      test_rollover_shard_transaction(
        fixture,
        archived_output,
        new_active_output,
        updated_directory_output,
        mint,
      ),
    ),
    run_trace_registry_spend(
      Directory(appended_model.directory),
      AdvanceDirectory {
        bucket_index: old_shard.bucket_index,
        voucher_hash,
        full_denom,
        previous_active_shard_name,
        new_active_shard_name,
      },
      test_output_ref(1),
      test_rollover_directory_transaction(
        fixture,
        archived_output,
        new_active_output,
        updated_directory_output,
        mint,
      ),
    ),
    trace_model_has_entry(rolled_model, old_entry),
    trace_model_has_entry(rolled_model, inserted_entry),
    rolled_model.directory == updated_directory,
  }
}

// Mutate only the untouched "noise" bucket. The directory transition should be
// rejected because rollover is allowed to change exactly one bucket.
test prop_trace_registry_rollover_rejects_when_non_target_bucket_changes(
  extra_bucket_seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.rollover.invalid_non_target_bucket_changed")

  let fixture = test_rollover_fixture(extra_bucket_seed)
  let TestRolloverFixture {
    old_directory,
    voucher_hash,
    full_denom,
    previous_active_shard_name,
    new_active_shard_name,
    bucket_index,
    archived_output,
    new_active_output,
    updated_directory,
    mint,
    ..
  } = fixture
  let mutated_directory =
    TraceRegistryDirectoryDatum {
      buckets: list.map(
        updated_directory.buckets,
        fn(bucket) {
          if bucket.bucket_index == bucket_index {
            bucket
          } else {
            TraceRegistryDirectoryBucket { ..bucket, archived_shard_names: [] }
          }
        },
      ),
    }

  run_trace_registry_spend(
    Directory(old_directory),
    AdvanceDirectory {
      bucket_index,
      voucher_hash,
      full_denom,
      previous_active_shard_name,
      new_active_shard_name,
    },
    test_output_ref(1),
    test_rollover_directory_transaction(
      fixture,
      archived_output,
      new_active_output,
      test_directory_output(mutated_directory.buckets),
      mint,
    ),
  )
}

// Mutate the archived copy of the old shard. Rollover must preserve the old
// shard contents exactly before it can be archived.
test prop_trace_registry_rollover_rejects_when_old_shard_is_not_preserved(
  extra_bucket_seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.rollover.invalid_old_shard_not_preserved")

  let fixture = test_rollover_fixture(extra_bucket_seed)
  let TestRolloverFixture {
    old_shard,
    voucher_hash,
    full_denom,
    new_active_shard_name,
    updated_directory,
    new_active_output,
    mint,
    ..
  } = fixture
  let mutated_archived_output =
    test_shard_output(
      old_shard.bucket_index,
      "active-0a",
      [test_expected_entry("transfer/channel-88/uatia")],
    )

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    test_rollover_shard_transaction(
      fixture,
      mutated_archived_output,
      new_active_output,
      test_directory_output(updated_directory.buckets),
      mint,
    ),
  )
}

// Mutate the new active shard so it contains more than the single inserted
// entry. Rollover must create a fresh shard with exactly the new mapping.
test prop_trace_registry_rollover_rejects_when_new_shard_is_not_exact_new_entry(
  extra_bucket_seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.rollover.invalid_new_shard_not_exact_entry")

  let fixture = test_rollover_fixture(extra_bucket_seed)
  let TestRolloverFixture {
    old_shard,
    old_entry,
    voucher_hash,
    full_denom,
    new_active_shard_name,
    updated_directory,
    archived_output,
    mint,
    ..
  } = fixture
  let mutated_new_active_output =
    test_shard_output(
      old_shard.bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom), old_entry],
    )

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    test_rollover_shard_transaction(
      fixture,
      archived_output,
      mutated_new_active_output,
      test_directory_output(updated_directory.buckets),
      mint,
    ),
  )
}

// Remove the voucher mint and leave only the new shard NFT mint. Rollover must
// stay coupled to a matching voucher mint so the registry cannot be written
// arbitrarily.
test prop_trace_registry_rollover_rejects_without_matching_voucher_mint(
  extra_bucket_seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.trace.rollover.invalid_missing_voucher_mint")

  let fixture = test_rollover_fixture(extra_bucket_seed)
  let TestRolloverFixture {
    old_shard,
    voucher_hash,
    full_denom,
    new_active_shard_name,
    updated_directory,
    archived_output,
    new_active_output,
    ..
  } = fixture

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    test_rollover_shard_transaction(
      fixture,
      archived_output,
      new_active_output,
      test_directory_output(updated_directory.buckets),
      from_asset(test_shard_policy_id(), new_active_shard_name, 1),
    ),
  )
}

test trace_registry_rollover_insert_succeeds_and_preserves_old_shard() {
  let full_denom = "transfer/channel-77/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_entry =
    TraceRegistryEntry {
      voucher_hash: voucher_asset_name.voucher_denom_hash(
        "transfer/channel-7/uosmo",
      ),
      full_denom: "transfer/channel-7/uosmo",
    }
  let old_shard = TraceRegistryShardDatum { bucket_index, entries: [old_entry] }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(
        bucket_index,
        previous_active_shard_name,
        old_shard.entries,
      ),
    }
  let directory_input =
    test_directory_input(1, bucket_index, previous_active_shard_name, [])
  let archived_output =
    test_shard_output(
      bucket_index,
      previous_active_shard_name,
      old_shard.entries,
    )
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )
  let updated_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [previous_active_shard_name],
        },
      ],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input, directory_input],
      outputs: [archived_output, new_active_output, updated_directory_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_directory_does_not_advance() fail {
  let full_denom = "transfer/channel-77/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_shard = TraceRegistryShardDatum { bucket_index, entries: [] }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, previous_active_shard_name, []),
    }
  let directory_input =
    test_directory_input(1, bucket_index, previous_active_shard_name, [])
  let archived_output =
    test_shard_output(bucket_index, previous_active_shard_name, [])
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )
  let stale_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: previous_active_shard_name,
          archived_shard_names: [],
        },
      ],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input, directory_input],
      outputs: [archived_output, new_active_output, stale_directory_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_spent_shard_is_not_old_active() fail {
  let full_denom = "transfer/channel-88/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let spent_shard_name = "archived-0a"
  let directory_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_entry =
    TraceRegistryEntry {
      voucher_hash: voucher_asset_name.voucher_denom_hash(
        "transfer/channel-7/uosmo",
      ),
      full_denom: "transfer/channel-7/uosmo",
    }
  let old_shard = TraceRegistryShardDatum { bucket_index, entries: [old_entry] }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(
        bucket_index,
        spent_shard_name,
        old_shard.entries,
      ),
    }
  let directory_input =
    test_directory_input(
      1,
      bucket_index,
      directory_active_shard_name,
      [spent_shard_name],
    )
  let archived_output =
    test_shard_output(bucket_index, spent_shard_name, old_shard.entries)
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )
  let updated_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [directory_active_shard_name, spent_shard_name],
        },
      ],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input, directory_input],
      outputs: [archived_output, new_active_output, updated_directory_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_hash_exists_in_archived_shard() fail {
  let full_denom = "transfer/channel-88/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let archived_shard_name = "archived-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_shard = TraceRegistryShardDatum { bucket_index, entries: [] }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, previous_active_shard_name, []),
    }
  let directory_input =
    test_directory_input(
      1,
      bucket_index,
      previous_active_shard_name,
      [archived_shard_name],
    )
  let archived_shard_reference_input =
    Input {
      output_reference: test_output_ref(2),
      output: test_shard_output(
        bucket_index,
        archived_shard_name,
        [test_expected_entry(full_denom)],
      ),
    }
  let archived_output =
    test_shard_output(bucket_index, previous_active_shard_name, [])
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )
  let updated_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [
            archived_shard_name, previous_active_shard_name,
          ],
        },
      ],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input, directory_input],
      reference_inputs: [archived_shard_reference_input],
      outputs: [archived_output, new_active_output, updated_directory_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_updated_directory_output_uses_wrong_auth_token() fail {
  let full_denom = "transfer/channel-66/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_shard = TraceRegistryShardDatum { bucket_index, entries: [] }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_shard_output(bucket_index, previous_active_shard_name, []),
    }
  let directory_input =
    test_directory_input(1, bucket_index, previous_active_shard_name, [])
  let archived_output =
    test_shard_output(bucket_index, previous_active_shard_name, [])
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )
  let forged_directory_output =
    test_directory_output_with_token_name(
      "forged-dir",
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [previous_active_shard_name],
        },
      ],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input, directory_input],
      outputs: [archived_output, new_active_output, forged_directory_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Shard(old_shard),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_advance_directory_succeeds_for_valid_rollover() {
  let full_denom = "transfer/channel-99/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_directory =
    TraceRegistryDirectoryDatum {
      buckets: [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: previous_active_shard_name,
          archived_shard_names: [],
        },
      ],
    }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_directory_output(old_directory.buckets),
    }
  let updated_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [previous_active_shard_name],
        },
      ],
    )
  let archived_output =
    test_shard_output(bucket_index, previous_active_shard_name, [])
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [updated_directory_output, archived_output, new_active_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Directory(old_directory),
    AdvanceDirectory {
      bucket_index,
      voucher_hash,
      full_denom,
      previous_active_shard_name,
      new_active_shard_name,
    },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_advance_directory_fails_when_previous_shard_is_not_archived() fail {
  let full_denom = "transfer/channel-99/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_directory =
    TraceRegistryDirectoryDatum {
      buckets: [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: previous_active_shard_name,
          archived_shard_names: [],
        },
      ],
    }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_directory_output(old_directory.buckets),
    }
  let invalid_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [],
        },
      ],
    )
  let archived_output =
    test_shard_output(bucket_index, previous_active_shard_name, [])
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [invalid_directory_output, archived_output, new_active_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Directory(old_directory),
    AdvanceDirectory {
      bucket_index,
      voucher_hash,
      full_denom,
      previous_active_shard_name,
      new_active_shard_name,
    },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_advance_directory_fails_when_bucket_set_is_not_bijective() fail {
  let full_denom = "transfer/channel-101/uatom"
  let voucher_hash = voucher_asset_name.voucher_denom_hash(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let other_bucket_index = bucket_index + 1
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_directory =
    TraceRegistryDirectoryDatum {
      buckets: [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: previous_active_shard_name,
          archived_shard_names: [],
        },
        TraceRegistryDirectoryBucket {
          bucket_index: other_bucket_index,
          active_shard_name: "other-active",
          archived_shard_names: [],
        },
      ],
    }
  let spent_input =
    Input {
      output_reference: test_output_ref(0),
      output: test_directory_output(old_directory.buckets),
    }
  let invalid_directory_output =
    test_directory_output(
      [
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: new_active_shard_name,
          archived_shard_names: [previous_active_shard_name],
        },
        TraceRegistryDirectoryBucket {
          bucket_index,
          active_shard_name: "duplicate-bucket",
          archived_shard_names: [],
        },
      ],
    )
  let archived_output =
    test_shard_output(bucket_index, previous_active_shard_name, [])
  let new_active_output =
    test_shard_output(
      bucket_index,
      new_active_shard_name,
      [test_expected_entry(full_denom)],
    )

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [invalid_directory_output, archived_output, new_active_output],
      mint: from_asset(
        test_voucher_policy_id(),
        voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
        1,
      )
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  run_trace_registry_spend(
    Directory(old_directory),
    AdvanceDirectory {
      bucket_index,
      voucher_hash,
      full_denom,
      previous_active_shard_name,
      new_active_shard_name,
    },
    test_output_ref(0),
    transaction,
  )
}
