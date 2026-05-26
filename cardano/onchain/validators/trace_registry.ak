// Trace registry state is Cardano-local metadata used to reverse the canonical
// 28-byte voucher core back into the canonical ICS-20 full denom trace.
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
// - the inserted full denom must hash exactly to the voucher core
// - directory witnesses must carry the exact deployed directory auth token and
//   sit at the same trace-registry script address as the shard they govern
// - existing mappings are immutable once written
// - rollover must preserve old shard contents exactly while moving future writes
//   to a fresh active shard chosen in the directory
//
// Operational model:
// - the first four bits of the voucher core choose one of 16 buckets
// - each bucket has one active shard NFT plus zero or more archived shard NFTs
// - a separate directory UTxO tracks which shard token name is currently active
// - first-seen voucher mints either append to the active shard or, if the
//   off-chain builder predicts the tx is too large, atomically roll over the
//   bucket and insert into a fresh active shard in the same transaction
use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{Input, Output, OutputReference, Transaction}
use ibc/apps/transfer/bridge_registry
use ibc/apps/transfer/trace_registry.{
  AdvanceDirectory, Directory, InsertTrace, RolloverInsertTrace, Shard,
  TraceRegistryDatum, TraceRegistryDirectoryBucket, TraceRegistryDirectoryDatum,
  TraceRegistryEntry, TraceRegistryRedeemer, TraceRegistryShardDatum,
  bucket_index_for_hash,
}
use ibc/apps/transfer/voucher_asset_name
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

validator spend_trace_registry(
  shard_nft_policy_id: PolicyId,
  directory_auth_token: AuthToken,
  bridge_registry_token: AuthToken,
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
    let bridge_registry_datum =
      bridge_registry.find_registry_datum(transaction, bridge_registry_token)
    let voucher_minting_policy_id =
      bridge_registry_datum.active_voucher_policy_id

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
              directory_auth_token,
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
              reference_inputs,
              outputs,
              mint,
              shard_nft_policy_id,
              directory_auth_token,
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
              reference_inputs,
              outputs,
              mint,
              shard_nft_policy_id,
              directory_auth_token,
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
  directory_auth_token: AuthToken,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect
    bytearray.length(voucher_hash) == voucher_asset_name.voucher_denom_hash_length
  expect bytearray.length(full_denom) > 0

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let shard_token =
    expect_single_registry_token(spent_output, shard_nft_policy_id)
  // Plain appends do not spend the directory. Instead they must carry the
  // current directory as a reference input so the validator can authenticate
  // that the spent shard token is still the bucket's active writable shard.
  let directory_input =
    find_unique_directory_input(
      reference_inputs,
      spent_output.address,
      directory_auth_token,
    )
  expect Directory(directory_datum): TraceRegistryDatum =
    validator_utils.get_inline_datum(directory_input.output)
  expect Some(directory_bucket) =
    find_bucket(directory_datum.buckets, old_datum.bucket_index)
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
  let voucher_hash_matches =
    voucher_asset_name.voucher_denom_hash(full_denom) == voucher_hash
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
  // First-seen writes must be globally unique within the bucket, not merely new
  // relative to the currently active shard. Archived shards remain canonical
  // history, so appends carry them as reference witnesses and must prove the
  // hash does not already exist anywhere else in the bucket.
  let archived_shards_are_clean =
    bucket_shards_do_not_contain_hash(
      reference_inputs,
      spent_output.address,
      shard_nft_policy_id,
      directory_bucket.archived_shard_names,
      voucher_hash,
    )
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
    archived_shards_are_clean,
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
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  directory_auth_token: AuthToken,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect
    bytearray.length(voucher_hash) == voucher_asset_name.voucher_denom_hash_length
  expect bytearray.length(full_denom) > 0
  expect bytearray.length(new_active_shard_name) > 0

  let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }
  let current_active_token =
    expect_single_registry_token(spent_output, shard_nft_policy_id)
  // Rollovers do spend the directory, so the old directory state is read from
  // normal inputs rather than reference inputs. This lets the shard validator
  // prove the consumed shard was the bucket's old active shard at rollover time.
  let directory_input =
    find_unique_directory_input(
      inputs,
      spent_output.address,
      directory_auth_token,
    )
  expect Directory(old_directory): TraceRegistryDatum =
    validator_utils.get_inline_datum(directory_input.output)
  expect Some(directory_bucket) =
    find_bucket(old_directory.buckets, old_datum.bucket_index)

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
        // require the exact canonical directory token at the registry address.
        if output.address != spent_output.address {
          False
        } else if !output_has_only_token(output, directory_auth_token) {
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
    voucher_asset_name.voucher_denom_hash(full_denom) == voucher_hash,
    matching_voucher_mint_present(
      mint,
      voucher_hash,
      voucher_minting_policy_id,
      benchmark_voucher_minting_policy_id,
    ),
    assets.has_nft(mint, shard_nft_policy_id, new_active_shard_name),
    list.find(
      old_datum.entries,
      fn(entry) { entry.voucher_hash == voucher_hash },
    ) == None,
    // Rollover inserts must also prove global bucket uniqueness. The spent old
    // active shard is checked above, and every archived shard named in the old
    // directory must be carried as a reference witness and shown not to contain
    // the incoming voucher hash.
    bucket_shards_do_not_contain_hash(
      reference_inputs,
      spent_output.address,
      shard_nft_policy_id,
      directory_bucket.archived_shard_names,
      voucher_hash,
    ),
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
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint,
  shard_nft_policy_id: PolicyId,
  directory_auth_token: AuthToken,
  voucher_minting_policy_id: PolicyId,
  benchmark_voucher_minting_policy_id: PolicyId,
) -> Bool {
  expect
    bytearray.length(voucher_hash) == voucher_asset_name.voucher_denom_hash_length
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
        } else if !output_has_only_token(output, directory_auth_token) {
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
  expect Some(bucket) = find_bucket(old_directory.buckets, bucket_index)

  and {
    // The spent output itself must also be the exact configured directory UTxO,
    // not merely "some" single shard-policy token carrying a Directory datum.
    output_has_only_token(spent_output, directory_auth_token),
    bucket_index == bucket_index_for_hash(voucher_hash),
    voucher_asset_name.voucher_denom_hash(full_denom) == voucher_hash,
    matching_voucher_mint_present(
      mint,
      voucher_hash,
      voucher_minting_policy_id,
      benchmark_voucher_minting_policy_id,
    ),
    assets.has_nft(mint, shard_nft_policy_id, new_active_shard_name),
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
    // The directory spend path independently proves bucket-wide uniqueness so a
    // malformed sibling shard spend cannot smuggle a duplicate through archived
    // history while still satisfying the directory transition shape.
    bucket_shards_do_not_contain_hash(
      reference_inputs,
      spent_output.address,
      shard_nft_policy_id,
      bucket.archived_shard_names,
      voucher_hash,
    ),
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
    quantity_of(
      mint,
      voucher_minting_policy_id,
      voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_hash),
    ) > 0
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

fn has_directory_datum(output: Output) -> Bool {
  expect datum: TraceRegistryDatum = validator_utils.get_inline_datum(output)

  when datum is {
    Directory(_) -> True
    _ -> False
  }
}

fn output_has_exact_directory_token(
  output: Output,
  expected_address,
  directory_auth_token: AuthToken,
) -> Bool {
  output.address == expected_address && output_has_only_token(
    output,
    directory_auth_token,
  )
}

fn find_unique_directory_input(
  inputs: List<Input>,
  expected_address,
  directory_auth_token: AuthToken,
) -> Input {
  // We require exactly one authenticated directory witness. This prevents
  // ambiguous transactions from presenting multiple directory candidates and
  // lets shard writes bind themselves to one authoritative bucket view using
  // the exact directory token chosen at deployment time.
  expect [input] =
    list.filter(
      inputs,
      fn(input) {
        // Reference-script UTxOs also appear in `reference_inputs`, but they do
        // not carry a trace-registry directory datum. Branch explicitly before
        // decoding so non-directory helper UTxOs cannot crash this filter.
        if output_has_exact_directory_token(
          input.output,
          expected_address,
          directory_auth_token,
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

fn has_shard_datum(output: Output) -> Bool {
  expect datum: TraceRegistryDatum = validator_utils.get_inline_datum(output)

  when datum is {
    Shard(_) -> True
    _ -> False
  }
}

fn find_unique_shard_input(
  inputs: List<Input>,
  expected_address,
  shard_token: AuthToken,
) -> Input {
  expect [input] =
    list.filter(
      inputs,
      fn(input) {
        if input.output.address != expected_address {
          False
        } else if !output_has_only_token(input.output, shard_token) {
          False
        } else {
          has_shard_datum(input.output)
        }
      },
    )

  input
}

fn bucket_shards_do_not_contain_hash(
  reference_inputs: List<Input>,
  expected_address,
  shard_nft_policy_id: PolicyId,
  shard_names: List<ByteArray>,
  voucher_hash: ByteArray,
) -> Bool {
  list.all(
    shard_names,
    fn(shard_name) {
      let shard_input =
        find_unique_shard_input(
          reference_inputs,
          expected_address,
          AuthToken { policy_id: shard_nft_policy_id, name: shard_name },
        )
      expect Shard(shard): TraceRegistryDatum =
        validator_utils.get_inline_datum(shard_input.output)

      list.find(shard.entries, fn(entry) { entry.voucher_hash == voucher_hash }) == None
    },
  )
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
