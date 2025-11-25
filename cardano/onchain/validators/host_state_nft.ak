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

use aiken/collection/list
use aiken/transaction.{
  Input, Mint, OutputReference, ScriptContext, Transaction, find_input,
}
use aiken/transaction/value.{AssetName}
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
  mint(redeemer: NFTRedeemer, _policy_id: Data, ctx: ScriptContext) {
    let ScriptContext { transaction, purpose } = ctx
    
    expect Mint(own_policy) = purpose
    let Transaction { inputs, mint, .. } = transaction
    
    when redeemer is {
      MintInitial -> {
        // 1. Verify the specified UTXO is consumed
        expect validate_utxo_consumed(inputs, utxo_ref)
        
        // 2. Get minted assets for this policy
        let minted_assets = value.from_minted_value(mint)
        let own_minted = value.tokens(minted_assets, own_policy)
        
        // 3. Verify exactly 1 token minted with correct name
        expect
          list.length(own_minted) == 1 && {
            expect Some((token_name, quantity)) = list.head(own_minted)
            and {
              token_name == host_state_token_name,
              quantity == 1,
            }
          }
        
        True
      }
    }
  }
  
  else(_) {
    fail @"HostState NFT can only be minted"
  }
}

