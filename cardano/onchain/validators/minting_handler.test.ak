use cardano/address.{Address, Script}
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler.{
  HandlerState, empty_ibc_state_root,
}
use ibc/core/ics_025_handler_interface/handler_datum.{
  HandlerDatum, handler_token_name,
}
use minting_handler

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
<<<<<<< HEAD
      ibc_state_root: empty_ibc_state_root,
=======
      ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
>>>>>>> main
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

  minting_handler.mint_handler.mint(
    output_reference,
    update_handler_script_hash,
    Void,
    policy_id,
    transaction,
  )
}

test fail_mint_handler_invalid_datum() fail {
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
          datum: NoDatum,
          reference_script: None,
        },
      ],
      mint: from_asset(policy_id, handler_token_name, 1),
    }

  minting_handler.mint_handler.mint(
    output_reference,
    update_handler_script_hash,
    Void,
    policy_id,
    transaction,
  )
}
