use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{MintPortRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{HandlerBindPort}
use ibc/utils/string as string_utils
use minting_port

type MockData {
  handler_token: AuthToken,
  port_minting_policy_id: PolicyId,
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  handler_input: Input,
  port_number: Int,
  port_token: AuthToken,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken { policy_id: "mock handler policy_id", name: "mock name" }

  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_number = 100

  let spend_module_script_hash = "mock spend_module_script_hash"

  let spend_handler_output_reference =
    OutputReference {
      transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    }

  let handler_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
      },
      token: handler_token,
    }

  let handler_input =
    Input {
      output_reference: spend_handler_output_reference,
      output: Output {
        address: from_script("mock handler script hash"),
        value: from_asset(handler_token.policy_id, handler_token.name, 1),
        datum: InlineDatum(handler_datum),
        reference_script: None,
      },
    }

  let port_token_name =
    string_utils.int_to_string(port_number)
      |> auth.generate_token_name(handler_token, port_keys.port_prefix, _)
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  MockData {
    handler_token,
    port_minting_policy_id,
    spend_module_script_hash,
    handler_input,
    port_number,
    port_token,
  }
}

test mint_port_succeed() {
  let mock = setup()

  //==============================arrange redeemer============================
  let redeemer: Redeemer =
    MintPortRedeemer {
      handler_token: mock.handler_token,
      spend_module_script_hash: mock.spend_module_script_hash,
      port_number: mock.port_number,
    }

  //===============================arrange inputs===============================
  let inputs = [mock.handler_input]

  //==============================arrange outputs==============================
  let module_output =
    Output {
      address: from_script(mock.spend_module_script_hash),
      value: from_asset(mock.port_token.policy_id, mock.port_token.name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  let outputs = [module_output]
  //==============================arrange mint==============================
  let mint = from_asset(mock.port_token.policy_id, mock.port_token.name, 1)

  //==============================arrange redeemers==============================
  let handler_redeemer: Redeemer = HandlerBindPort

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.handler_input.output_reference), handler_redeemer),
      Pair(Mint(mock.port_minting_policy_id), redeemer),
    ]

  let redeemer =
    MintPortRedeemer {
      handler_token: mock.handler_token,
      spend_module_script_hash: mock.spend_module_script_hash,
      port_number: mock.port_number,
    }

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: inputs,
      outputs: outputs,
      mint: mint,
      redeemers: redeemers,
    }

  minting_port.mint_port.mint(
    redeemer,
    mock.port_minting_policy_id,
    transaction,
  )
}
