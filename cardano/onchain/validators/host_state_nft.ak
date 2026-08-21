// IBC Host State NFT Minting Policy
//
// This policy mints a unique NFT that identifies the canonical IBC Host State UTXO.
//
// Design:
// - One-time mint: Uses a specific UTXO reference to ensure uniqueness
// - Single token: Exactly 1 token with name "ibc_host_state"
// - Terminal burn: after a sealed proof-serving window, the deployment key may
//   burn the singleton alongside the final HostState reclaim.
//
// The NFT serves as:
// 1. Unique identifier for the HostState UTXO
// 2. Continuity proof across state updates
// 3. Indexing key for querying history

use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId, tokens}
use cardano/transaction.{
  Input, OutputReference, Spend, Transaction, find_input,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HostStateRedeemer, ReclaimHostState,
}

/// Redeemer for NFT minting
pub type NFTRedeemer {
  /// Mint the initial NFT (one-time only)
  MintInitial
  /// Burn the terminal HostState anchor after its proof-serving window.
  BurnFinal { reclaim_to: VerificationKeyHash }
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
/// 3. Burning is allowed only for the typed, sealed final-reclaim transition
validator host_state_nft(utxo_ref: OutputReference) {
  mint(redeemer: NFTRedeemer, policy_id: PolicyId, transaction: Transaction) {
    let Transaction {
      inputs,
      mint,
      redeemers,
      ..
    } = transaction

    when redeemer is {
      MintInitial -> {
        // The designated UTxO makes the initial mint unique.
        expect validate_utxo_consumed(inputs, utxo_ref)
        let own_minted = tokens(mint, policy_id)
        and {
          dict.size(own_minted) == 1,
          when dict.get(own_minted, host_state_token_name) is {
            Some(quantity) -> quantity == 1
            None -> False
          },
        }
      }
      BurnFinal { reclaim_to } -> {
        let token = AuthToken { policy_id, name: host_state_token_name }
        expect [host_input] =
          list.filter(
            inputs,
            fn(input) { auth.contain_auth_token(input.output, token) },
          )
        expect Some(host_redeemer_raw) =
          pairs.get_first(redeemers, Spend(host_input.output_reference))
        expect host_redeemer: HostStateRedeemer = host_redeemer_raw
        expect ReclaimHostState { reclaim_to: host_reclaim_to } = host_redeemer

        // The NFT uniquely identifies the canonical Host input. Its spending
        // validator owns the terminal-state, proof-window, deployer-signature,
        // and exact ADA-payout checks. Repeating those here bloats the final
        // transaction without adding an independent authentication boundary.
        and {
          host_reclaim_to == reclaim_to,
          auth.burn_auth_token(mint, token),
        }
      }
    }
  }

  else(_) {
    fail @"HostState NFT can only be minted"
  }
}
