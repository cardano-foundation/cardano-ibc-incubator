use aiken/cbor
use aiken/hash
use aiken/list
use aiken/transaction.{OutputReference, ScriptContext}
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

validator {
  /// mint_identifier mint a nonce token to use it as an identifier.
  /// token name based on an output reference so that it can only be minted once.
  fn mint_identifier(redeemer: OutputReference, context: ScriptContext) -> Bool {
    let (this_policy_id, inputs, _, mint) =
      validator_utils.extract_minting_context(context)

    expect list.any(inputs, fn(input) { input.output_reference == redeemer })

    let token_name = cbor.serialise(redeemer) |> hash.sha3_256()

    let auth_token = AuthToken { policy_id: this_policy_id, name: token_name }

    expect mint |> auth.mint_auth_token(auth_token)

    True
  }
}
