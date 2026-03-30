// Trace registry shards are auxiliary Cardano-local state used to reverse a
// voucher asset hash back into the canonical ICS-20 full denom trace.
//
// This validator is intentionally separate from HostState:
// - HostState remains the single IBC commitment thread proved to counterparties
// - trace-registry entries are local metadata for Cardano-side voucher handling
// - changing trace lookups must not change the IBC commitment root or proof flow
//
// Security model:
// - a mapping is accepted only when the same transaction mints the matching
//   voucher token under the voucher policy
// - the full denom must hash to the voucher token name exactly
// - once recorded, a hash -> full_denom mapping is immutable
//
// Operational model:
// - the first four bits of the voucher hash select one of 16 shards
// - each shard is its own thread UTxO protected by a unique shard NFT
// - first-seen voucher mints append to one shard; repeated mints reuse the
//   existing mapping and do not touch the registry
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{OutputReference, Transaction}
use ibc/apps/transfer/trace_registry.{
  InsertTrace, TraceRegistryEntry, TraceRegistryRedeemer, TraceRegistryShardDatum,
  shard_index_for_hash,
}
use ibc/utils/validator_utils

validator spend_trace_registry(
  shard_nft_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
) {
  spend(
    datum: Option<TraceRegistryShardDatum>,
    redeemer: TraceRegistryRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, .. } = transaction

    expect Some(old_datum) = datum
    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    // A shard is a dedicated thread UTxO carrying exactly one shard NFT. The
    // validator preserves that non-lovelace value so inserts cannot silently
    // migrate the registry thread to a different asset set.
    let spent_non_lovelace = assets.without_lovelace(spent_output.value)
    expect [spent_policy] = assets.policies(spent_non_lovelace)
    expect spent_policy == shard_nft_policy_id
    expect dict.size(tokens(spent_output.value, shard_nft_policy_id)) == 1

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) {
          output.address == spent_output.address
            && assets.without_lovelace(output.value) == spent_non_lovelace
        },
      )

    expect assets.lovelace_of(updated_output.value) >=
      assets.lovelace_of(spent_output.value)

    expect updated_datum: TraceRegistryShardDatum =
      validator_utils.get_inline_datum(updated_output)

    let InsertTrace { voucher_hash, full_denom } = redeemer

    expect bytearray.length(voucher_hash) == 32
    expect bytearray.length(full_denom) > 0

    let expected_entry = TraceRegistryEntry { voucher_hash, full_denom }

    and {
      // The first four bits of the voucher hash decide the owning shard, so every
      // client can deterministically find the right UTxO from the asset id alone.
      updated_datum.shard_index == old_datum.shard_index,
      old_datum.shard_index == shard_index_for_hash(voucher_hash),
      // The registry only records a mapping if the same transaction proves it is
      // minting the corresponding voucher token under the voucher policy.
      crypto.sha3_256(full_denom) == voucher_hash,
      quantity_of(mint, voucher_minting_policy_id, voucher_hash) > 0,
      // Mappings are append-only and immutable once inserted.
      list.find(old_datum.entries, fn(entry) { entry.voucher_hash == voucher_hash }) == None,
      updated_datum.entries == list.concat(old_datum.entries, [expected_entry]),
    }
  }

  else(_) {
    fail
  }
}
