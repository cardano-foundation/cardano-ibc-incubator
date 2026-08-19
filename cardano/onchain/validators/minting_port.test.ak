use aiken/collection/list
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/address.{from_script}
use cardano/assets.{PolicyId, Value, from_asset, zero}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{MintPortRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/host_state.{
  ModuleRegistration, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{BindPort}
use minting_port

type MockData {
  host_state_nft_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  host_state_input: Input,
  port_id: ByteArray,
  port_token: AuthToken,
}

fn setup() -> MockData {
  let host_state_nft_policy_id = "mock host_state_nft_policy_id"

  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_id = "transfer"

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

  let port_token_name = port_keys.port_token_name(port_id)
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  MockData {
    host_state_nft_policy_id,
    port_minting_policy_id,
    spend_module_script_hash,
    host_state_input,
    port_id,
    port_token,
  }
}

fn port_token_for(mock: MockData, port_id: ByteArray) -> AuthToken {
  let port_token_name = port_keys.port_token_name(port_id)
  AuthToken { policy_id: mock.port_minting_policy_id, name: port_token_name }
}

fn module_value_for_ports(mock: MockData, ports: List<ByteArray>) -> Value {
  list.foldl(
    ports,
    zero,
    fn(port_id, value) {
      let token = port_token_for(mock, port_id)
      value |> assets.merge(from_asset(token.policy_id, token.name, 1))
    },
  )
}

fn validate_mint_port(mock: MockData, module_value: Value) -> Bool {
  let redeemer: Redeemer =
    MintPortRedeemer {
      spend_module_script_hash: mock.spend_module_script_hash,
      port_id: mock.port_id,
    }
  let module_output =
    Output {
      address: from_script(mock.spend_module_script_hash),
      value: module_value,
      datum: NoDatum,
      reference_script: None,
    }
  let mint = from_asset(mock.port_token.policy_id, mock.port_token.name, 1)

  //==============================arrange redeemers==============================
  let registration =
    ModuleRegistration {
      module_script_hash: mock.spend_module_script_hash,
      port_token: mock.port_token,
      module_token: AuthToken {
        policy_id: "mock module token policy",
        name: "mock module token",
      },
    }
  let host_state_redeemer: Redeemer =
    BindPort { port_id: mock.port_id, registration, port_siblings: [] }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock.host_state_input.output_reference), host_state_redeemer),
      Pair(Mint(mock.port_minting_policy_id), redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock.host_state_input],
      outputs: [module_output],
      mint,
      redeemers,
    }

  minting_port.mint_port.mint(
    mock.host_state_nft_policy_id,
    MintPortRedeemer {
      spend_module_script_hash: mock.spend_module_script_hash,
      port_id: mock.port_id,
    },
    mock.port_minting_policy_id,
    transaction,
  )
}

test mint_port_succeed() {
  let mock = setup()
  validate_mint_port(
    mock,
    from_asset(mock.port_token.policy_id, mock.port_token.name, 1),
  )
}

/// Exercise the largest module capability-token set allowed by the shared cap.
/// This fixture is collected by the transaction-budget CI job together with the
/// HostState tenth-port transition.
test mint_port_tenth_port_succeeds_at_module_cap() {
  let mock = setup()
  validate_mint_port(
    mock,
    module_value_for_ports(
      mock,
      [
        "ica-controller", "ica-host", "icqhost", "mock", "nft-transfer",
        "transfer-v2", "transfer-v3", "wasm", "wasm-hooks", "transfer",
      ],
    ),
  )
}
