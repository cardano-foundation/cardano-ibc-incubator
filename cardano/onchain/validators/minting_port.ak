use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, NoDatum, Output, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{MintPortRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/host_state.{
  host_state_token_name, max_bound_ports,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, HostStateRedeemer,
}

// Keep the existing per-module capability-token bound aligned with the
// protocol-wide HostState bound.
fn valid_number_of_ports(
  module_output: Output,
  port_minting_policy_id: PolicyId,
) -> Bool {
  let number_of_ports =
    module_output.value |> assets.tokens(port_minting_policy_id) |> dict.size()
  number_of_ports <= max_bound_ports
}

fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      assets.has_nft(input.output.value, nft_policy, host_state_token_name)
    },
  )
}

validator mint_port(host_state_nft_policy_id: PolicyId) {
  mint(
    redeemer: MintPortRedeemer,
    port_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
    trace @"mint_port: extracted context data"

    let MintPortRedeemer { spend_module_script_hash, port_id } = redeemer

    // The full textual identifier is authenticated by HostState and committed at
    // `ports/{port_id}`. Hash it to the fixed 32-byte Cardano asset-name domain.
    let port_token_name = port_keys.port_token_name(port_id)
    let port_token =
      AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

    expect Some(host_state_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)
    expect Some(spent_host_state_redeemer) =
      pairs.get_first(redeemers, Spend(host_state_input.output_reference))
    expect host_state_redeemer: HostStateRedeemer = spent_host_state_redeemer
    let valid_host_state_operator =
      when host_state_redeemer is {
        BindPort { port_id: bound_port_id, registration, .. } -> and {
            bound_port_id == port_id,
            registration.module_script_hash == spend_module_script_hash,
            registration.port_token == port_token,
          }
        _ -> False
      }
    expect [module_output] =
      transaction.find_script_outputs(outputs, spend_module_script_hash)

    trace @"mint_port: transfer module output datum": module_output.datum
    expect NoDatum = module_output.datum
    and {
      valid_host_state_operator?,
      auth.mint_auth_token(mint, port_token)?,
      auth.contain_auth_token(module_output, port_token)?,
      valid_number_of_ports(module_output, port_minting_policy_id)?,
    }
  }

  else(_) {
    fail
  }
}
