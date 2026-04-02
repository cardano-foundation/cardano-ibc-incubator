// Trace registry state is Cardano-local metadata used to reverse a voucher hash
// back into the canonical ICS-20 full denom trace.
//
// The registry deliberately lives outside HostState:
// - HostState remains the counterparty-proven IBC commitment thread
// - trace-registry entries are only needed for Cardano-side voucher handling
// - changing local reverse-lookup metadata must not perturb the IBC proof root
//
// Security model:
// - a new mapping is accepted only when the same transaction mints the matching
//   voucher token under the production voucher minting policy or, on local
//   benchmark deployments only, under the dedicated benchmark voucher policy
// - the inserted full denom must hash exactly to the voucher token name
// - existing mappings are immutable once written
// - rollover must preserve old shard contents exactly while moving future writes
//   to a fresh active shard chosen in the directory
//
// Operational model:
// - the first four bits of the voucher hash choose one of 16 buckets
// - each bucket has one active shard NFT plus zero or more archived shard NFTs
// - a separate directory UTxO tracks which shard token name is currently active
// - first-seen voucher mints either append to the active shard or, if the
//   off-chain builder predicts the tx is too large, atomically roll over the
//   bucket and insert into a fresh active shard in the same transaction
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/fuzz
use aiken/primitive/bytearray
use cardano/address.{from_script}
use cardano/assets.{PolicyId, Value, add, from_asset, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use ibc/apps/transfer/trace_registry.{
  AdvanceDirectory, Directory, InsertTrace, RolloverInsertTrace, Shard,
  TraceRegistryDatum, TraceRegistryDirectoryBucket, TraceRegistryDirectoryDatum,
  TraceRegistryEntry, TraceRegistryRedeemer, TraceRegistryShardDatum,
  bucket_index_for_hash,
}
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

validator spend_trace_registry(
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) {
  spend(
    datum: Option<TraceRegistryDatum>,
    redeemer: TraceRegistryRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, reference_inputs, outputs, mint, .. } =
      transaction

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output
    expect Some(datum) = datum

    when datum is {
      Shard(old_shard) ->
        when redeemer is {
          InsertTrace { voucher_hash, full_denom } ->
            validate_insert_trace(
              old_shard,
              voucher_hash,
              full_denom,
              spent_output,
              reference_inputs,
              outputs,
              mint,
              shard_nft_policy_id,
              voucher_minting_policy_id,
              benchmark_voucher_minting_policy_id,
            )

          RolloverInsertTrace {
            voucher_hash,
            full_denom,
            new_active_shard_name,
          } ->
            validate_rollover_insert_trace(
              old_shard,
              voucher_hash,
              full_denom,
              new_active_shard_name,
              spent_output,
              inputs,
              outputs,
              mint,
              shard_nft_policy_id,
              voucher_minting_policy_id,
              benchmark_voucher_minting_policy_id,
            )

          _ -> fail
        }

      Directory(old_directory) ->
        when redeemer is {
          AdvanceDirectory {
            bucket_index,
            voucher_hash,
            full_denom,
            previous_active_shard_name,
            new_active_shard_name,
          } ->
            validate_advance_directory(
              old_directory,
              bucket_index,
              voucher_hash,
              full_denom,
              previous_active_shard_name,
              new_active_shard_name,
              spent_output,
              outputs,
              mint,
              shard_nft_policy_id,
              voucher_minting_policy_id,
              benchmark_voucher_minting_policy_id,
            )

          _ -> fail
        }
    }
  }

  else(_) {
    fail
  }
}

fn validate_insert_trace(
  old_datum: TraceRegistryShardDatum,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
  spent_output: Output,
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect bytearray.length(voucher_hash) == 32
  expect bytearray.length(full_denom) > 0

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let shard_token =
    expect_single_registry_token(spent_output, shard_nft_policy_id)
  // Plain appends do not spend the directory. Instead they must carry the
  // current directory as a reference input so the validator can authenticate
  // that the spent shard token is still the bucket's active writable shard.
  let directory_input =
    find_unique_directory_input(reference_inputs, shard_nft_policy_id)
  expect Directory(directory_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(directory_input.output)
  let updated_output =
    find_unique_output(
      outputs,
      fn(output) {
        output.address == spent_output.address && output_has_only_token(
          output,
          shard_token,
        )
      },
    )
  expect Shard(updated_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(updated_output)

  let bucket_index_matches_hash =
    old_datum.bucket_index == bucket_index_for_hash(voucher_hash)
  let active_shard_matches_directory =
    bucket_has_active_shard(
      directory_datum,
      old_datum.bucket_index,
      shard_token.name,
    )
  let voucher_hash_matches = crypto.sha3_256(full_denom) == voucher_hash
  let matching_voucher_mint =
    matching_voucher_mint_present(
      mint,
      voucher_hash,
      voucher_minting_policy_id,
      benchmark_voucher_minting_policy_id,
    )
  let voucher_hash_is_new =
    list.find(
      old_datum.entries,
      fn(entry) { entry.voucher_hash == voucher_hash },
    ) == None
  let appended_output_matches =
    updated_datum.entries == list.concat(old_datum.entries, [expected_entry])

  and {
    updated_datum.bucket_index == old_datum.bucket_index,
    bucket_index_matches_hash,
    // This is the canonicality check for non-rollover writes: an archived shard
    // may still exist and be readable, but it can no longer accept inserts once
    // the directory points the bucket at a newer active shard.
    active_shard_matches_directory,
    voucher_hash_matches,
    matching_voucher_mint,
    voucher_hash_is_new,
    appended_output_matches,
  }
}

fn validate_rollover_insert_trace(
  old_datum: TraceRegistryShardDatum,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
  new_active_shard_name: ByteArray,
  spent_output: Output,
  inputs: List<Input>,
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect bytearray.length(voucher_hash) == 32
  expect bytearray.length(full_denom) > 0
  expect bytearray.length(new_active_shard_name) > 0

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let current_active_token =
    expect_single_registry_token(spent_output, shard_nft_policy_id)
  // Rollovers do spend the directory, so the old directory state is read from
  // normal inputs rather than reference inputs. This lets the shard validator
  // prove the consumed shard was the bucket's old active shard at rollover time.
  let directory_input = find_unique_directory_input(inputs, shard_nft_policy_id)
  expect Directory(old_directory): TraceRegistryDatum =
    validator_utils.get_inline_datum(directory_input.output)

  let archived_output =
    find_unique_output(
      outputs,
      fn(output) {
        output.address == spent_output.address && output_has_only_token(
          output,
          current_active_token,
        )
      },
    )
  expect Shard(archived_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(archived_output)

  let new_active_token =
    AuthToken { policy_id: shard_nft_policy_id, name: new_active_shard_name }
  let new_active_output =
    find_unique_output(
      outputs,
      fn(output) {
        output.address == spent_output.address && output_has_only_token(
          output,
          new_active_token,
        )
      },
    )
  expect Shard(new_active_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(new_active_output)

  let updated_directory_output =
    find_unique_output(
      outputs,
      fn(output) {
        // The shard-side rollover path must bind itself to the real updated
        // directory UTxO, not merely to "some" Directory datum. We therefore
        // require the exact same auth-token set as the spent directory input.
        if output.address != spent_output.address {
          False
        } else if !output_has_same_registry_token_set(
          output,
          directory_input.output,
        ) {
          False
        } else {
          has_directory_datum(output)
        }
      },
    )
  expect Directory(updated_directory): TraceRegistryDatum =
    validator_utils.get_inline_datum(updated_directory_output)

  and {
    old_datum.bucket_index == bucket_index_for_hash(voucher_hash),
    // Without this check, a rollover could be forged from an arbitrary archived
    // shard by manufacturing matching outputs. The spent shard must be the one
    // the directory currently recognizes as writable for this bucket.
    bucket_has_active_shard(
      old_directory,
      old_datum.bucket_index,
      current_active_token.name,
    ),
    crypto.sha3_256(full_denom) == voucher_hash,
    matching_voucher_mint_present(
      mint,
      voucher_hash,
      voucher_minting_policy_id,
      benchmark_voucher_minting_policy_id,
    ),
    quantity_of(mint, shard_nft_policy_id, new_active_shard_name) == 1,
    list.find(
      old_datum.entries,
      fn(entry) { entry.voucher_hash == voucher_hash },
    ) == None,
    archived_datum == old_datum,
    new_active_datum == TraceRegistryShardDatum {
      bucket_index: old_datum.bucket_index,
      entries: [expected_entry],
    },
    // The shard validator independently rechecks the directory transition so a
    // malformed sibling directory output cannot sneak through even if the
    // directory spend validator is not the only script being inspected.
    directory_rollover_matches(
      old_directory,
      updated_directory,
      old_datum.bucket_index,
      current_active_token.name,
      new_active_shard_name,
    ),
  }
}

fn validate_advance_directory(
  old_directory: TraceRegistryDirectoryDatum,
  bucket_index: Int,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
  previous_active_shard_name: ByteArray,
  new_active_shard_name: ByteArray,
  spent_output: Output,
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect bytearray.length(voucher_hash) == 32
  expect bytearray.length(full_denom) > 0
  expect bytearray.length(previous_active_shard_name) > 0
  expect bytearray.length(new_active_shard_name) > 0

  let updated_output =
    find_unique_output(
      outputs,
      fn(output) {
        // The canonical directory transition must happen on the same NFT-bearing
        // directory UTxO that was spent. This prevents a transaction from
        // keeping the real directory unchanged while introducing a forged
        // auxiliary Directory datum somewhere else in the outputs.
        if output.address != spent_output.address {
          False
        } else if !output_has_same_registry_token_set(output, spent_output) {
          False
        } else {
          has_directory_datum(output)
        }
      },
    )
  expect Directory(updated_directory): TraceRegistryDatum =
    validator_utils.get_inline_datum(updated_output)

  let previous_active_token =
    AuthToken {
      policy_id: shard_nft_policy_id,
      name: previous_active_shard_name,
    }
  let new_active_token =
    AuthToken { policy_id: shard_nft_policy_id, name: new_active_shard_name }
  let archived_output =
    find_unique_output(
      outputs,
      fn(output) {
        output.address == spent_output.address && output_has_only_token(
          output,
          previous_active_token,
        )
      },
    )
  expect Shard(archived_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(archived_output)

  let new_active_output =
    find_unique_output(
      outputs,
      fn(output) {
        output.address == spent_output.address && output_has_only_token(
          output,
          new_active_token,
        )
      },
    )
  expect Shard(new_active_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(new_active_output)

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }

  and {
    bucket_index == bucket_index_for_hash(voucher_hash),
    crypto.sha3_256(full_denom) == voucher_hash,
    matching_voucher_mint_present(
      mint,
      voucher_hash,
      voucher_minting_policy_id,
      benchmark_voucher_minting_policy_id,
    ),
    quantity_of(mint, shard_nft_policy_id, new_active_shard_name) == 1,
    directory_rollover_matches(
      old_directory,
      updated_directory,
      bucket_index,
      previous_active_shard_name,
      new_active_shard_name,
    ),
    archived_datum.bucket_index == bucket_index,
    list.find(
      archived_datum.entries,
      fn(entry) { entry.voucher_hash == voucher_hash },
    ) == None,
    new_active_datum == TraceRegistryShardDatum {
      bucket_index,
      entries: [expected_entry],
    },
  }
}

fn matching_voucher_mint_present(
  mint,
  voucher_hash: ByteArray,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  let has_production_voucher_mint =
    quantity_of(mint, voucher_minting_policy_id, voucher_hash) > 0
  let has_benchmark_voucher_mint =
    bytearray.length(benchmark_voucher_minting_policy_id) > 0 && quantity_of(
      mint,
      benchmark_voucher_minting_policy_id,
      voucher_hash,
    ) > 0

  has_production_voucher_mint || has_benchmark_voucher_mint
}

fn expect_single_registry_token(
  output: Output,
  policy_id: PolicyId,
) -> AuthToken {
  expect [token_name] =
    output.value
      |> assets.tokens(policy_id)
      |> dict.keys()

  AuthToken { policy_id, name: token_name }
}

fn output_has_only_token(output: Output, token: AuthToken) -> Bool {
  auth.contains_only_auth_tokens(output, [token])
}

fn output_has_same_registry_token_set(left: Output, right: Output) -> Bool {
  assets.without_lovelace(left.value) == assets.without_lovelace(right.value)
}

fn has_directory_datum(output: Output) -> Bool {
  expect datum: TraceRegistryDatum = validator_utils.get_inline_datum(output)

  when datum is {
    Directory(_) -> True
    _ -> False
  }
}

fn output_has_single_registry_token_under_policy(
  output: Output,
  policy_id: PolicyId,
) -> Bool {
  // The directory is authenticated by ownership of exactly one shard-policy
  // token and its inline Directory datum, not by a hardcoded token name.
  // Deployment chooses the directory token name, so the validator must accept
  // any single-token auth output under the shard policy and then inspect datum.
  when output.value |> tokens(policy_id) |> dict.keys() is {
    [token_name] ->
      auth.contains_only_auth_tokens(
        output,
        [AuthToken { policy_id, name: token_name }],
      )

    _ -> False
  }
}

fn find_unique_directory_input(
  inputs: List<Input>,
  policy_id: PolicyId,
) -> Input {
  // We require exactly one authenticated directory witness. This prevents
  // ambiguous transactions from presenting multiple directory candidates and
  // lets shard writes bind themselves to one authoritative bucket view.
  expect [input] =
    list.filter(
      inputs,
      fn(input) {
        // Reference-script UTxOs also appear in `reference_inputs`, but they do
        // not carry a trace-registry directory datum. Branch explicitly before
        // decoding so non-directory helper UTxOs cannot crash this filter.
        if output_has_single_registry_token_under_policy(
          input.output,
          policy_id,
        ) {
          has_directory_datum(input.output)
        } else {
          False
        }
      },
    )

  input
}

fn find_unique_output(
  outputs: List<Output>,
  predicate: fn(Output) -> Bool,
) -> Output {
  expect [output] = list.filter(outputs, predicate)
  output
}

fn find_bucket(
  buckets: List<TraceRegistryDirectoryBucket>,
  bucket_index: Int,
) -> Option<TraceRegistryDirectoryBucket> {
  list.find(buckets, fn(bucket) { bucket.bucket_index == bucket_index })
}

fn bucket_has_active_shard(
  directory: TraceRegistryDirectoryDatum,
  bucket_index: Int,
  shard_name: ByteArray,
) -> Bool {
  when find_bucket(directory.buckets, bucket_index) is {
    Some(bucket) -> bucket.active_shard_name == shard_name
    None -> False
  }
}

fn bucket_indices_are_unique(
  buckets: List<TraceRegistryDirectoryBucket>,
) -> Bool {
  // Each directory bucket is keyed by deterministic bucket_index. Duplicate
  // indices would let the updated directory carry ambiguous state for one hash
  // partition, so uniqueness is enforced before any rollover comparison.
  do_bucket_indices_are_unique(buckets, [])
}

fn do_bucket_indices_are_unique(
  remaining: List<TraceRegistryDirectoryBucket>,
  seen: List<Int>,
) -> Bool {
  when remaining is {
    [] -> True
    [bucket, ..rest] ->
      !list.has(seen, bucket.bucket_index) && do_bucket_indices_are_unique(
        rest,
        [bucket.bucket_index, ..seen],
      )
  }
}

fn directory_rollover_matches(
  old_directory: TraceRegistryDirectoryDatum,
  updated_directory: TraceRegistryDirectoryDatum,
  bucket_index: Int,
  previous_active_shard_name: ByteArray,
  new_active_shard_name: ByteArray,
) -> Bool {
  and {
    // The bucket set itself must be stable across rollover: no duplicates, no
    // dropped buckets, and no extra buckets may appear in the updated directory.
    bucket_indices_are_unique(old_directory.buckets),
    bucket_indices_are_unique(updated_directory.buckets),
    list.length(old_directory.buckets) == list.length(updated_directory.buckets),
    // Forward check: every old bucket must still exist after rollover. Only the
    // targeted bucket is allowed to change, and its change is fully specified.
    list.all(
      old_directory.buckets,
      fn(old_bucket) {
        when
          find_bucket(updated_directory.buckets, old_bucket.bucket_index)
        is {
          Some(updated_bucket) ->
            if old_bucket.bucket_index == bucket_index {
              and {
                old_bucket.active_shard_name == previous_active_shard_name,
                updated_bucket.active_shard_name == new_active_shard_name,
                updated_bucket.archived_shard_names == list.concat(
                  old_bucket.archived_shard_names,
                  [previous_active_shard_name],
                ),
              }
            } else {
              updated_bucket == old_bucket
            }

          None -> False
        }
      },
    ),
    // Reverse check: every updated bucket must also have existed before. Paired
    // with the forward check and uniqueness, this gives a bijection between the
    // old and new bucket sets rather than a loose subset/superset relation.
    list.all(
      updated_directory.buckets,
      fn(updated_bucket) {
        when
          find_bucket(old_directory.buckets, updated_bucket.bucket_index)
        is {
          Some(_) -> True
          None -> False
        }
      },
    ),
  }
}

fn test_shard_policy_id() -> PolicyId {
  "trace shard policy"
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
  Output {
    address: test_registry_address(),
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
  TraceRegistryEntry { voucher_hash: crypto.sha3_256(full_denom), full_denom }
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
  let voucher_hash = crypto.sha3_256(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_entry =
    TraceRegistryEntry {
      voucher_hash: crypto.sha3_256("transfer/channel-7/uosmo"),
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
    from_asset(test_voucher_policy_id(), voucher_hash, 1)
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

  and {
    spend_trace_registry.spend(
      test_shard_policy_id(),
      test_voucher_policy_id(),
      test_disabled_benchmark_voucher_policy_id(),
      Some(Shard(old_shard)),
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
    spend_trace_registry.spend(
      test_shard_policy_id(),
      test_voucher_policy_id(),
      test_disabled_benchmark_voucher_policy_id(),
      Some(Directory(old_directory)),
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
  }
}

// Mutate only the untouched "noise" bucket. The directory transition should be
// rejected because rollover is allowed to change exactly one bucket.
test prop_trace_registry_rollover_rejects_when_non_target_bucket_changes(
  extra_bucket_seed via fuzz.int(),
) fail {
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Directory(old_directory)),
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
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

test trace_registry_insert_trace_succeeds_with_matching_voucher_mint() {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(TraceRegistryShardDatum { bucket_index, entries: [] })),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_succeeds_with_matching_benchmark_voucher_mint() {
  let full_denom = "transfer/channel-7/benchmark-uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_benchmark_voucher_policy_id(),
    Some(Shard(TraceRegistryShardDatum { bucket_index, entries: [] })),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_succeeds_with_matching_benchmark_voucher_mint_and_extra_reference_inputs() {
  let full_denom = "transfer/channel-7/benchmark-uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_benchmark_voucher_policy_id(),
    Some(Shard(TraceRegistryShardDatum { bucket_index, entries: [] })),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_without_matching_voucher_mint() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(TraceRegistryShardDatum { bucket_index, entries: [] })),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_bucket_does_not_match_hash() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(
      Shard(
        TraceRegistryShardDatum {
          bucket_index: wrong_bucket_index,
          entries: [],
        },
      ),
    ),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_hash_already_exists() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(
      Shard(TraceRegistryShardDatum { bucket_index, entries: [existing_entry] }),
    ),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_insert_trace_fails_when_spent_shard_is_not_directory_active() fail {
  let full_denom = "transfer/channel-7/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(TraceRegistryShardDatum { bucket_index, entries: [] })),
    InsertTrace { voucher_hash, full_denom },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_succeeds_and_preserves_old_shard() {
  let full_denom = "transfer/channel-77/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let previous_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_entry =
    TraceRegistryEntry {
      voucher_hash: crypto.sha3_256("transfer/channel-7/uosmo"),
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_directory_does_not_advance() fail {
  let full_denom = "transfer/channel-77/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_spent_shard_is_not_old_active() fail {
  let full_denom = "transfer/channel-88/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
  let bucket_index = bucket_index_for_hash(voucher_hash)
  let spent_shard_name = "archived-0a"
  let directory_active_shard_name = "active-0a"
  let new_active_shard_name = "active-0a-v2"
  let old_entry =
    TraceRegistryEntry {
      voucher_hash: crypto.sha3_256("transfer/channel-7/uosmo"),
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_rollover_insert_fails_when_updated_directory_output_uses_wrong_auth_token() fail {
  let full_denom = "transfer/channel-66/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Shard(old_shard)),
    RolloverInsertTrace { voucher_hash, full_denom, new_active_shard_name },
    test_output_ref(0),
    transaction,
  )
}

test trace_registry_advance_directory_succeeds_for_valid_rollover() {
  let full_denom = "transfer/channel-99/uatom"
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Directory(old_directory)),
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
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Directory(old_directory)),
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
  let voucher_hash = crypto.sha3_256(full_denom)
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
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    test_disabled_benchmark_voucher_policy_id(),
    Some(Directory(old_directory)),
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
