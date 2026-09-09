use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  MintClientRedeemer, PruneConsensusState,
}
use ibc/client/ics_007_tendermint_client/consensus_history.{ConsensusStateDatum}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{HostStateRedeemer} as host_redeemer
use ibc/utils/validator_utils

/// Archive outputs cannot be edited or moved. Spending one burns its NFT and
/// requires the HostState deletion branch in the same transaction.
validator spend_consensus_state(host_state_nft_policy_id: PolicyId) {
  spend(
    datum: Option<ConsensusStateDatum>,
    _redeemer: Void,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(record) = datum
    expect Some(input) = transaction.find_input(tx.inputs, own_ref)
    let token = consensus_history.token(record.client_token, record.height)
    expect auth.contain_auth_token(input.output, token)
    expect [host] =
      list.filter(
        tx.inputs,
        fn(input) {
          assets.has_nft(
            input.output.value,
            host_state_nft_policy_id,
            host_state_token_name,
          )
        },
      )
    expect Some(raw_host_redeemer) =
      pairs.get_first(tx.redeemers, Spend(host.output_reference))
    expect host_redeemer.PruneConsensusState { client_token, height, .. }: HostStateRedeemer =
      raw_host_redeemer
    expect Some(raw_mint_redeemer) =
      pairs.get_first(tx.redeemers, Mint(token.policy_id))
    expect PruneConsensusState {
      client_token: mint_client,
      height: mint_height,
    }: MintClientRedeemer = raw_mint_redeemer
    and {
      (client_token == record.client_token)?,
      (height == record.height)?,
      (mint_client == client_token)?,
      (mint_height == height)?,
      validator_utils.require_exact_marker_mint(
        tx.mint,
        token.policy_id,
        token.name,
        -1,
      )?,
    }
  }

  else(_) {
    fail
  }
}
