use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Transaction}
use ibc/auth.{AuthToken}
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
    //========================valid mint=======================
    let auth_token = AuthToken { policy_id, name: handler_token_name }

    // mint only 1 auth token
    //========================valid output========================
    expect [handler_output] =
      outputs |> transaction.find_script_outputs(update_handler_script_hash)

    // handler datum is initialized valid
    expect handler_datum: HandlerDatum =
      validator_utils.get_inline_datum(handler_output)
    let valid_datum =
      handler_datum
        |> handler_datum.is_initialized_valid(auth_token)

    // handler utxo contains auth token
    and {
      inputs |> list.any(fn(input) { input.output_reference == utxo_ref }),
      mint |> auth.mint_auth_token(auth_token),
      handler_output |> auth.contain_auth_token(auth_token),
      valid_datum,
    }
  }

  else(_) {
    fail
  }
}
