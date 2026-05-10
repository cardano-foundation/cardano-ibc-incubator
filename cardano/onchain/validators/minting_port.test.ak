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
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{BindPort}
use ibc/utils/string as string_utils
use minting_port

type MockData {
  host_state_nft_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  host_state_input: Input,
  port_number: Int,
  port_token: AuthToken,
}

fn setup() -> MockData {
  let host_state_nft_policy_id = "mock host_state_nft_policy_id"

  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_number = 100

  let spend_module_script_hash = "mock spend_module_script_hash"

  let host_state_output_reference =
    OutputReference {
      transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    }

  let host_state_input =
    Input {
      output_reference: host_state_output_reference,
      output: Output {
        address: from_script("mock host state script hash"),
        value: from_asset(host_state_nft_policy_id, host_state_token_name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  let port_token_name =
    string_utils.int_to_string(port_number)
      |> auth.generate_token_name(
          AuthToken {
            policy_id: host_state_nft_policy_id,
            name: host_state_token_name,
          },
          port_keys.port_prefix,
          _,
        )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  MockData {
    host_state_nft_policy_id,
    port_minting_policy_id,
    spend_module_script_hash,
    host_state_input,
    port_number,
    port_token,
  }
}

test mint_port_succeed() {
  let mock = setup()

  //==============================arrange redeemer============================
  let redeemer: Redeemer =
    MintPortRedeemer {
      spend_module_script_hash: mock.spend_module_script_hash,
      port_number: mock.port_number,
    }

  //===============================arrange inputs===============================
  let inputs = [mock.host_state_input]

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
  let host_state_redeemer: Redeemer =
    BindPort { port: mock.port_number, port_siblings: [] }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.host_state_input.output_reference), host_state_redeemer),
      Pair(Mint(mock.port_minting_policy_id), redeemer),
    ]

  let redeemer =
    MintPortRedeemer {
      spend_module_script_hash: mock.spend_module_script_hash,
      port_number: mock.port_number,
    }

  //==========================arrange context=========================
  let transaction =
    Transaction { ..transaction.placeholder, inputs, outputs, mint, redeemers }

  minting_port.mint_port.mint(
    mock.host_state_nft_policy_id,
    redeemer,
    mock.port_minting_policy_id,
    transaction,
  )
}
