use aiken/cbor
use aiken/collection/list
use aiken/crypto
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

validator minting_identifier {
  /// mint_identifier mint a nonce token to use it as an identifier.
  /// token name based on an output reference so that it can only be minted once.
  mint(redeemer: OutputReference, policy_id: PolicyId, transaction: Transaction) {
    let Transaction { inputs, mint, .. } = transaction

    expect list.any(inputs, fn(input) { input.output_reference == redeemer })

    let token_name = cbor.serialise(redeemer) |> crypto.sha3_256()

    let auth_token = AuthToken { policy_id, name: token_name }

    expect mint |> auth.mint_auth_token(auth_token)

    True
  }

  else(_) {
    fail
  }
}
