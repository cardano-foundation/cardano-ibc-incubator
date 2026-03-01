// IBC Client Minting Validator - STT Architecture

use aiken/collection/list
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, Input, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      let quantity =
        quantity_of(input.output.value, nft_policy, host_state_token_name)
      quantity == 1
    },
  )
}

validator mint_client_stt(
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
) {
  mint(
    _redeemer: MintClientRedeemer,
    client_mint_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, validity_range, .. } = transaction

    expect Some(host_state_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)

    expect InlineDatum(datum) = host_state_input.output.datum
    expect host_state_datum: HostStateDatum = datum
    let client_id_sequence = host_state_datum.state.next_client_sequence

    // Generate client token name using the HostState NFT as base token
    let host_state_nft =
      AuthToken {
        policy_id: host_state_nft_policy_id,
        name: host_state_token_name,
      }
    let id_str = string_utils.int_to_string(client_id_sequence)
    let client_token_name =
      auth.generate_token_name(host_state_nft, client_prefix, id_str)
    let client_token =
      AuthToken { policy_id: client_mint_policy_id, name: client_token_name }

    expect [client_output] =
      outputs
        |> transaction.find_script_outputs(spend_client_script_hash)

    expect client_output_datum: ClientDatum =
      validator_utils.get_inline_datum(client_output)
    let valid_output_datum =
      client_output_datum
        |> client_datum.is_initialized_valid(client_token)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    let is_state_active =
      client_state.status(
        client_output_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_output_datum.state.consensus_states,
      ) == Active

    and {
      (mint |> auth.mint_auth_token(client_token))?,
      (client_output |> auth.contains_only_auth_tokens([client_token]))?,
      valid_output_datum?,
      is_state_active?,
    }
  }

  else(_) {
    fail
  }
}
