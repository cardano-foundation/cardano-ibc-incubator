use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{OutputReference, ScriptContext}
use aiken/transaction/credential.{Script}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/handler_datum.{
  HandlerDatum, handler_token_name,
}
use ibc/utils/validator_utils

validator(
  utxo_ref: OutputReference,
  update_handler_script_hash: Hash<Blake2b_224, Script>,
) {
  fn mint_handler(_redeemer: Void, context: ScriptContext) -> Bool {
    let (this_policy_id, inputs, outputs, mint) =
      validator_utils.extract_minting_context(context)

    //========================valid input=======================
    // input contains nonce utxo so that the policy_id of each token is unique 
    // and only 1 instance of it minted
    expect inputs |> list.any(fn(input) { input.output_reference == utxo_ref })

    //========================valid mint=======================
    let auth_token =
      AuthToken { policy_id: this_policy_id, name: handler_token_name }

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
}
