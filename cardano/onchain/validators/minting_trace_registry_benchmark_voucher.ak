// Local-only benchmark voucher minting policy for the on-chain trace registry.
//
// This policy is intentionally much cheaper than the production ICS-20 voucher
// mint path because it exists only to benchmark shard growth and rollover on a
// local devnet. The production registry validator still enforces the important
// invariant we care about here:
// - the minted token name must equal blake2b_224(full_denom)
//
// This policy only constrains the benchmark token shape so the benchmark path
// still looks like a voucher mint:
// - exactly one asset under this policy per tx
// - token name must be 28 bytes (blake2b-224 output size)
// - quantity must be positive

use aiken/collection/dict
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, tokens}
use cardano/transaction.{Transaction}

validator mint_trace_registry_benchmark_voucher {
  mint(_redeemer: Data, policy_id: PolicyId, transaction: Transaction) {
    let own_minted = tokens(transaction.mint, policy_id)

    expect dict.size(own_minted) == 1
    let token_names = dict.keys(own_minted)
    expect [token_name] = token_names
    expect Some(quantity) = dict.get(own_minted, token_name)

    and {
      bytearray.length(token_name) == 28,
      quantity > 0,
    }
  }

  else(_) {
    fail @"Trace-registry benchmark voucher policy only allows positive single-asset voucher-like mints"
  }
}
