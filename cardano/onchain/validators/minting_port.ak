use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, NoDatum, Output, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{MintPortRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerBindPort, HandlerOperator,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/utils/string as string_utils

// Introduced to prevent high spending costs or potentially prevent tx from being executed.
const max_number_of_ports = 10

// Checks the max number of ports is not exceeded
fn valid_number_of_ports(
  module_output: Output,
  port_minting_policy_id: PolicyId,
) -> Bool {
  let number_of_ports =
    module_output.value |> assets.tokens(port_minting_policy_id) |> dict.size()
  number_of_ports <= max_number_of_ports
}

validator mint_port(host_state_nft_policy_id: PolicyId) {
  mint(
    redeemer: MintPortRedeemer,
    port_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
    trace @"mint_port: extracted context data"

    let MintPortRedeemer {
      handler_token,
      spend_module_script_hash,
      port_number,
    } = redeemer

    expect Some(handler_input) =
      list.find(
        inputs,
        fn(input) { input.output |> auth.contain_auth_token(handler_token) },
      )
    // spent handler redeemer is HandlerBindPort operator
    expect Some(spent_handler_redeemer) =
      pairs.get_first(redeemers, Spend(handler_input.output_reference))
    expect handler_operator: HandlerOperator = spent_handler_redeemer
    let valid_handler_operator = handler_operator == HandlerBindPort

    // Port tokens are referenced across IBC transactions that only have access to the
    // channel auth token name. Channel auth tokens are derived from the HostState NFT.
    //
    // To make the port-token name derivable from the channel-token name, the port-token
    // name must also be derived from the same HostState NFT base.
    let host_state_nft =
      AuthToken {
        policy_id: host_state_nft_policy_id,
        name: host_state_token_name,
      }
    let port_token_name =
      string_utils.int_to_string(port_number)
        |> auth.generate_token_name(host_state_nft, port_keys.port_prefix, _)
    let port_token =
      AuthToken { policy_id: port_minting_policy_id, name: port_token_name }
    expect [module_output] =
      outputs
        |> transaction.find_script_outputs(spend_module_script_hash)

    trace @"mint_port: transfer module output datum": module_output.datum
    expect NoDatum = module_output.datum
    and {
      valid_handler_operator?,
      auth.mint_auth_token(mint, port_token)?,
      (module_output |> auth.contain_auth_token(port_token))?,
      valid_number_of_ports(module_output, port_minting_policy_id)?,
    }
  }

  else(_) {
    fail
  }
}
