// IBC Host State NFT Minting Policy
//
// This policy mints a unique NFT that identifies the canonical IBC Host State UTXO.
//
// Design:
// - One-time mint: Uses a specific UTXO reference to ensure uniqueness
// - Single token: Exactly 1 token with name "ibc_host_state"
// - No burning: Once minted, the token cannot be burned (enforced by STT validator)
//
// The NFT serves as:
// 1. Unique identifier for the HostState UTXO
// 2. Continuity proof across state updates
// 3. Indexing key for querying history

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{AssetName, PolicyId, tokens}
use cardano/transaction.{
  Input, OutputReference, Transaction, find_input,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}

/// Redeemer for NFT minting
pub type NFTRedeemer {
  /// Mint the initial NFT (one-time only)
  MintInitial
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

/// Main minting policy for IBC Host State NFT
/// 
/// Enforces:
/// 1. Specific UTXO must be consumed (ensures one-time mint)
/// 2. Exactly 1 token minted with correct name
/// 3. No burning allowed
validator host_state_nft(utxo_ref: OutputReference) {
  mint(redeemer: NFTRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, mint, .. } = transaction
    
    when redeemer is {
      MintInitial -> {
        // 1. Verify the specified UTXO is consumed
        expect validate_utxo_consumed(inputs, utxo_ref)
        
        // 2. Get minted assets for this policy
        let own_minted = tokens(mint, policy_id)
        
        // 3. Verify exactly 1 token minted with correct name
        expect
          dict.size(own_minted) == 1 && {
            expect Some(quantity) = dict.get(own_minted, host_state_token_name)
            quantity == 1
          }
        
        True
      }
    }
  }
  
  else(_) {
    fail @"HostState NFT can only be minted"
  }
}

