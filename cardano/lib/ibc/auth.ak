use aiken/transaction.{Output}
use aiken/transaction/value.{AssetName, MintedValue, PolicyId}

pub type AuthToken {
  policy_id: PolicyId,
  name: AssetName,
}

pub fn contain_auth_token(output: Output, token: AuthToken) -> Bool {
  value.quantity_of(output.value, token.policy_id, token.name) == 1
}

pub fn mint_auth_token(mint: MintedValue, token: AuthToken) -> Bool {
  let minted_token_num =
    mint
      |> value.from_minted_value()
      |> value.quantity_of(token.policy_id, token.name)
  minted_token_num == 1
}
