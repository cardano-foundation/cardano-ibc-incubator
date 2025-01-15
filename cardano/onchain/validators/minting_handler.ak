use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{
  HandlerDatum, handler_token_name,
}
use ibc/utils/validator_utils

validator mint_handler(
  utxo_ref: OutputReference,
  update_handler_script_hash: ScriptHash,
) {
  mint(_redeemer: Void, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, outputs, mint, .. } = transaction

    //========================valid input=======================
    // input contains nonce utxo so that the policy_id of each token is unique 
    // and only 1 instance of it minted
    expect inputs |> list.any(fn(input) { input.output_reference == utxo_ref })

    //========================valid mint=======================
    let auth_token = AuthToken { policy_id, name: handler_token_name }

    // mint only 1 auth token
    expect mint |> auth.mint_auth_token(auth_token)

    //========================valid output========================
    expect [handler_output] =
      outputs |> transaction.find_script_outputs(update_handler_script_hash)

    // handler datum is initialized valid
    expect handler_datum: HandlerDatum =
      validator_utils.get_inline_datum(handler_output)
    expect
      handler_datum
        |> handler_datum.is_initialized_valid(auth_token)

    // handler utxo contains auth token
    expect handler_output |> auth.contain_auth_token(auth_token)

    True
  }

  else(_) {
    fail
  }
}

test mint_handler() {
  let output_reference =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }
  let update_handler_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let policy_id = #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

  let output_address =
    Address(
      Script(#"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"),
      None,
    )

  let handler_state =
    HandlerState {
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
    }

  let handler_token = AuthToken { policy_id, name: handler_token_name }

  let init_handler_datum =
    HandlerDatum { state: handler_state, token: handler_token }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          output_reference,
          Output {
            address: output_address,
            value: from_asset(policy_id, handler_token_name, 1),
            datum: NoDatum,
            reference_script: None,
          },
        ),
      ],
      outputs: [
        Output {
          address: output_address,
          value: from_asset(policy_id, handler_token_name, 1),
          datum: InlineDatum(init_handler_datum),
          reference_script: None,
        },
      ],
      mint: from_asset(policy_id, handler_token_name, 1),
    }

  mint_handler.mint(
    output_reference,
    update_handler_script_hash,
    Void,
    policy_id,
    transaction,
  )
}
