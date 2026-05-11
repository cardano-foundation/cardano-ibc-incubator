use cardano/address.{from_script}
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{BindPort}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{HandlerBindPort}
use spending_handler

test bind_port_succeeds() {
  let handler_policy_id = "mock handler policy id"
  let handler_token =
    AuthToken { policy_id: handler_policy_id, name: "handler" }
  let port_minting_policy_id = "mock port minting policy id"
  let handler_script_hash = "mock handler script hash"
  let handler_address = from_script(handler_script_hash)
  let handler_output_reference =
    OutputReference {
      transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    }

  let old_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
      },
      token: handler_token,
    }

  let new_datum =
    HandlerDatum {
      ..old_datum,
      state: HandlerState { ..old_datum.state, bound_port: [100] },
    }

  let handler_input =
    Input {
      output_reference: handler_output_reference,
      output: Output {
        address: handler_address,
        value: from_asset(handler_policy_id, handler_token.name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    }

  let handler_output =
    Output {
      address: handler_address,
      value: from_asset(handler_policy_id, handler_token.name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let mint_port_redeemer: Redeemer =
    BindPort {
      handler_token,
      spend_module_script_hash: "mock module script hash",
      port_number: 100,
    }
  let spend_handler_redeemer: Redeemer = HandlerBindPort
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(handler_output_reference), spend_handler_redeemer),
      Pair(Mint(port_minting_policy_id), mint_port_redeemer),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [handler_input],
      outputs: [handler_output],
      redeemers,
    }

  spending_handler.spend_handler.spend(
    "mock client minting policy id",
    "mock connection minting policy id",
    "mock channel minting policy id",
    port_minting_policy_id,
    Some(old_datum),
    HandlerBindPort,
    handler_output_reference,
    transaction,
  )
}

test bind_transfer_port_succeeds_with_deployment_shape() {
  let handler_policy_id =
    #"ae1def1ae3bd221cdf1bf8a46f1030a03e19ca37404b07c427fd999b"
  let handler_token =
    AuthToken { policy_id: handler_policy_id, name: #"68616e646c6572" }
  let port_minting_policy_id =
    #"881b9dfddebdc317817521dfb08602af1e9b133ea8bf4534072e476b"
  let identifier_policy_id =
    #"a00f2bd1a9fa85e89a15583d60eb4890abb49e2a11aa1722d0fee1bb"
  let identifier_name =
    #"b3321868a44d5084bb59381c6f6d70f438742b67159bbc7fedfad4ae817ad43d"
  let port_token_name =
    #"bc03ec5e81db99d5ba1d59aae96b81b4fe3643365a6e59fc313030"
  let transfer_module_script_hash =
    #"876bb2c991f231742c1c01e2cd88bd89abf8f4036ec7dd592b423d67"
  let handler_script_hash =
    #"a78cb4bc908989d0c957e27cf5a10368fdf9feabab3f64707292d589"
  let handler_address = from_script(handler_script_hash)
  let handler_output_reference =
    OutputReference {
      transaction_id: #"89e2880eb47999dcc568ba8519e86a15cce8a8c31d2c87b1b360190150614bc3",
      output_index: 0,
    }
  let nonce_output_reference =
    OutputReference {
      transaction_id: #"e5e829ce860b1efa1d7ec207d3e8e588be604e8da7ee34ea71f177d7339bc217",
      output_index: 1,
    }

  let old_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
      },
      token: handler_token,
    }
  let new_datum =
    HandlerDatum {
      ..old_datum,
      state: HandlerState { ..old_datum.state, bound_port: [100] },
    }

  let handler_input =
    Input {
      output_reference: handler_output_reference,
      output: Output {
        address: handler_address,
        value: from_asset(handler_policy_id, handler_token.name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    }
  let handler_output =
    Output {
      address: handler_address,
      value: from_asset(handler_policy_id, handler_token.name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }
  let module_output =
    Output {
      address: from_script(transfer_module_script_hash),
      value: from_asset(identifier_policy_id, identifier_name, 1)
        |> assets.merge(from_asset(port_minting_policy_id, port_token_name, 1)),
      datum: NoDatum,
      reference_script: None,
    }

  let spend_handler_redeemer: Redeemer = HandlerBindPort
  let mint_port_redeemer: Redeemer =
    BindPort {
      handler_token,
      spend_module_script_hash: transfer_module_script_hash,
      port_number: 100,
    }
  let mint_identifier_redeemer: Redeemer = nonce_output_reference
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(handler_output_reference), spend_handler_redeemer),
      Pair(Mint(port_minting_policy_id), mint_port_redeemer),
      Pair(Mint(identifier_policy_id), mint_identifier_redeemer),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [handler_input],
      outputs: [handler_output, module_output],
      mint: from_asset(port_minting_policy_id, port_token_name, 1)
        |> assets.merge(from_asset(identifier_policy_id, identifier_name, 1)),
      redeemers,
    }

  spending_handler.spend_handler.spend(
    #"dabd1739b39f65c21c251f21de7a2f88adf796fe22818678fad81f96",
    #"c3ffa0f0bed1b864c91d5f5a0ee483b97e3a8bac5a3028979fdefe99",
    #"ac4bd6010f4cbb2ac4b9c9e63337f1bf4c219cb846451b4f61c437b5",
    port_minting_policy_id,
    Some(old_datum),
    HandlerBindPort,
    handler_output_reference,
    transaction,
  )
}
