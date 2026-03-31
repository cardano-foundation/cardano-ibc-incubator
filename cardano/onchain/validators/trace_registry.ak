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
//   voucher token under the voucher minting policy
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
use aiken/primitive/bytearray
use cardano/address.{from_script}
use cardano/assets.{PolicyId, add, from_asset, quantity_of}
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
) {
  spend(
    datum: Option<TraceRegistryDatum>,
    redeemer: TraceRegistryRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, .. } = transaction

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
              outputs,
              mint,
              shard_nft_policy_id,
              voucher_minting_policy_id,
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
              outputs,
              mint,
              shard_nft_policy_id,
              voucher_minting_policy_id,
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
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect bytearray.length(voucher_hash) == 32
  expect bytearray.length(full_denom) > 0

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let shard_token =
    expect_single_registry_token(spent_output, shard_nft_policy_id)
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

  and {
    updated_datum.bucket_index == old_datum.bucket_index,
    old_datum.bucket_index == bucket_index_for_hash(voucher_hash),
    crypto.sha3_256(full_denom) == voucher_hash,
    quantity_of(mint, voucher_minting_policy_id, voucher_hash) > 0,
    list.find(
      old_datum.entries,
      fn(entry) { entry.voucher_hash == voucher_hash },
    ) == None,
    updated_datum.entries == list.concat(old_datum.entries, [expected_entry]),
  }
}

fn validate_rollover_insert_trace(
  old_datum: TraceRegistryShardDatum,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
  new_active_shard_name: ByteArray,
  spent_output: Output,
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect bytearray.length(voucher_hash) == 32
  expect bytearray.length(full_denom) > 0
  expect bytearray.length(new_active_shard_name) > 0

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let current_active_token =
    expect_single_registry_token(spent_output, shard_nft_policy_id)

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
        output.address == spent_output.address && has_directory_datum(output)
      },
    )
  expect Directory(updated_directory): TraceRegistryDatum =
    validator_utils.get_inline_datum(updated_directory_output)

  and {
    old_datum.bucket_index == bucket_index_for_hash(voucher_hash),
    crypto.sha3_256(full_denom) == voucher_hash,
    quantity_of(mint, voucher_minting_policy_id, voucher_hash) > 0,
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
    directory_matches_rollover(
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
) -> Bool {
  expect bytearray.length(voucher_hash) == 32
  expect bytearray.length(full_denom) > 0
  expect bytearray.length(previous_active_shard_name) > 0
  expect bytearray.length(new_active_shard_name) > 0

  let updated_output =
    find_unique_output(
      outputs,
      fn(output) {
        output.address == spent_output.address && output_has_same_registry_token_set(
          output,
          spent_output,
        ) && has_directory_datum(output)
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
    quantity_of(mint, voucher_minting_policy_id, voucher_hash) > 0,
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

fn directory_matches_rollover(
  directory: TraceRegistryDirectoryDatum,
  bucket_index: Int,
  previous_active_shard_name: ByteArray,
  new_active_shard_name: ByteArray,
) -> Bool {
  when find_bucket(directory.buckets, bucket_index) is {
    Some(bucket) ->
      bucket.active_shard_name == new_active_shard_name && list.has(
        bucket.archived_shard_names,
        previous_active_shard_name,
      )

    None -> False
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
    list.length(old_directory.buckets) == list.length(updated_directory.buckets),
    list.all(
      updated_directory.buckets,
      fn(updated_bucket) {
        when
          find_bucket(old_directory.buckets, updated_bucket.bucket_index)
        is {
          Some(old_bucket) ->
            if updated_bucket.bucket_index == bucket_index {
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
  }
}

fn test_shard_policy_id() -> PolicyId {
  "trace shard policy"
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

fn test_directory_output(buckets: List<TraceRegistryDirectoryBucket>) -> Output {
  Output {
    address: test_registry_address(),
    value: from_asset(test_shard_policy_id(), "dir", 1),
    datum: InlineDatum(Directory(TraceRegistryDirectoryDatum { buckets })),
    reference_script: None,
  }
}

fn test_expected_entry(full_denom: ByteArray) -> TraceRegistryEntry {
  TraceRegistryEntry { voucher_hash: crypto.sha3_256(full_denom), full_denom }
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

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [updated_output],
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
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

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [updated_output],
      mint: from_asset(test_voucher_policy_id(), "some-other-voucher", 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
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

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [updated_output],
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
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

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [spent_input],
      outputs: [updated_output],
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
    Some(
      Shard(TraceRegistryShardDatum { bucket_index, entries: [existing_entry] }),
    ),
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
      inputs: [spent_input],
      outputs: [archived_output, new_active_output, updated_directory_output],
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
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
      inputs: [spent_input],
      outputs: [archived_output, new_active_output, stale_directory_output],
      mint: from_asset(test_voucher_policy_id(), voucher_hash, 1)
        |> add(test_shard_policy_id(), new_active_shard_name, 1),
    }

  spend_trace_registry.spend(
    test_shard_policy_id(),
    test_voucher_policy_id(),
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
