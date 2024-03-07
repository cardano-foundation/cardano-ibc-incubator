use aiken/dict
use aiken/list
use aiken/transaction.{Mint, ScriptContext, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{MintPortRedeemer}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerBindPort, HandlerOperator,
}

validator {
  fn mint_port(redeemer: MintPortRedeemer, context: ScriptContext) -> Bool {
    let ScriptContext { transaction, purpose } = context
    expect Mint(port_minting_policy_id) = purpose
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
      redeemers |> dict.get(Spend(handler_input.output_reference))
    expect handler_operator: HandlerOperator = spent_handler_redeemer
    expect
      handler_operator == HandlerBindPort
    trace @"mint_port: handler redeemer is valid"

    let port_token_name =
      auth.generate_token_name(
        handler_token,
        port_keys.port_prefix,
        port_number,
      )
    let port_token =
      AuthToken { policy_id: port_minting_policy_id, name: port_token_name }
    expect auth.mint_auth_token(mint, port_token)
    trace @"mint_port: mint valid token"

    expect [module_output] =
      outputs
        |> transaction.find_script_outputs(spend_module_script_hash)
    expect module_output |> auth.contain_auth_token(port_token)
    trace @"mint_port: module output contain token"

    True
  }
}
