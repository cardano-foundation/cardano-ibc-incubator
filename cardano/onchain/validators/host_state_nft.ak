// IBC Host State NFT Minting Policy
//
// This policy mints a unique NFT that identifies the canonical IBC Host State UTXO.
//
// Design:
// - One-time mint: Uses a specific UTXO reference to ensure uniqueness
// - Single token: Exactly 1 token with name "ibc_host_state"
// - Final burn: The token can only be destroyed by burning exactly one token
//
// The NFT serves as:
// 1. Unique identifier for the HostState UTXO
// 2. Continuity proof across state updates
// 3. Indexing key for querying history

use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId, tokens}
use cardano/transaction.{
  Input, OutputReference, Redeemer, ScriptPurpose, Spend, Transaction,
  find_input,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  FinalizeShutdown, HostStateRedeemer,
}

/// Redeemer for the HostState NFT policy
pub type NFTRedeemer {
  /// Mint the initial NFT (one-time only)
  MintInitial
  /// Permanently destroy the NFT when the HostState shuts down
  BurnFinal
}

/// Validate that a specific UTXO is consumed in this transaction
/// 
/// This ensures the mint can only happen once (UTXO can only be spent once)
fn validate_utxo_consumed(
  inputs: List<Input>,
  utxo_ref: OutputReference,
) -> Bool {
  expect Some(_) = find_input(inputs, utxo_ref)
  True
}

/// Require the burn to accompany the final spend of the NFT-bearing HostState.
fn validate_final_host_state_spend(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  policy_id: PolicyId,
) -> Bool {
  expect Some(host_input) =
    list.find(
      inputs,
      fn(input) {
        assets.has_nft(input.output.value, policy_id, host_state_token_name)
      },
    )
  expect Some(host_redeemer_data) =
    pairs.get_first(redeemers, Spend(host_input.output_reference))
  expect host_redeemer: HostStateRedeemer = host_redeemer_data
  expect FinalizeShutdown = host_redeemer
  True
}

/// Main minting policy for IBC Host State NFT
/// 
/// Enforces:
/// 1. MintInitial consumes the configured UTXO and mints exactly 1 token
/// 2. BurnFinal destroys exactly 1 token and cannot affect other names
/// 3. BurnFinal accompanies a FinalizeShutdown spend of the HostState
validator host_state_nft(utxo_ref: OutputReference) {
  mint(redeemer: NFTRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, mint, redeemers, .. } = transaction

    let own_minted = tokens(mint, policy_id)
    expect dict.size(own_minted) == 1
    expect Some(quantity) = dict.get(own_minted, host_state_token_name)

    when redeemer is {
      MintInitial -> and {
          validate_utxo_consumed(inputs, utxo_ref),
          quantity == 1,
        }
      BurnFinal -> and {
          validate_final_host_state_spend(inputs, redeemers, policy_id),
          quantity == -1,
        }
    }
  }

  else(_) {
    fail @"HostState NFT policy can only mint or burn"
  }
}
