use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  CreateClient as HandlerCreateClient, HandlerOperator,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_client(spend_client_script_hash: Hash<Blake2b_224, Script>) {
  mint(
    redeemer: MintClientRedeemer,
    client_mint_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, redeemers, validity_range, .. } =
      transaction
    let handler_auth_token = redeemer.handler_auth_token

    //========================valid input=======================
    // input contains handler auth token
    expect Some(handler_input) =
      inputs
        |> list.find(
            fn(input) {
              input.output |> auth.contain_auth_token(handler_auth_token)
            },
          )

    // spent handler redeemer is CreateClient operator
    expect Some(spent_handler_redeemer) =
      pairs.get_first(redeemers, Spend(handler_input.output_reference))
    expect handler_operator: HandlerOperator = spent_handler_redeemer
    expect handler_operator == HandlerCreateClient

    //========================valid mint=======================
    // extract client id
    let spent_handler_output = handler_input.output
    expect spent_handler_datum: HandlerDatum =
      validator_utils.get_inline_datum(spent_handler_output)

    // mint just 1 client_state token
    let client_token_name =
      string_utils.int_to_string(spent_handler_datum.state.next_client_sequence)
        |> auth.generate_token_name(handler_auth_token, client_prefix, _)
    let client_token =
      AuthToken { policy_id: client_mint_policy_id, name: client_token_name }

    //========================valid output========================
    expect [client_output] =
      outputs
        |> transaction.find_script_outputs(spend_client_script_hash)

    // client utxo datum created valid
    expect client_output_datum: ClientDatum =
      validator_utils.get_inline_datum(client_output)
    let valid_output_datum =
      client_output_datum
        |> client_datum.is_initialized_valid(client_token)

    // client status must be Active
    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    let is_state_active =
      client_state.status(
        client_output_datum.state.client_state,
        // posix time in cardano is millisecond while time of cosmos tendermint is nanosecond
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
