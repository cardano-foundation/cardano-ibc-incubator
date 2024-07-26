use aiken/bytearray
use aiken/dict
use aiken/hash
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
  let minted_tokens =
    mint |> value.from_minted_value() |> value.tokens(token.policy_id)

  expect minted_tokens == ( dict.new() |> dict.insert(token.name, 1) )

  True
}

pub fn generate_token_name(
  base_token: AuthToken,
  prefix: ByteArray,
  sequence: ByteArray,
) -> ByteArray {
  let postfix = sequence

  expect (bytearray.length(postfix) <= 8)?

  let base_token_part =
    hash.sha3_256(
      base_token.policy_id
        |> bytearray.concat(base_token.name),
    )
      |> bytearray.take(20)

  let prefix_part = hash.sha3_256(prefix) |> bytearray.take(4)

  let full_name =
    base_token_part
      |> bytearray.concat(prefix_part)
      |> bytearray.concat(postfix)

  expect is_valid_token_name(full_name)?

  full_name
}

pub fn generate_token_name_from_another(
  another_token_name: ByteArray,
  prefix: ByteArray,
  sequence: ByteArray,
) -> ByteArray {
  let postfix = sequence

  expect (bytearray.length(postfix) <= 8)?

  let base_token_part = extract_token_base(another_token_name)

  let prefix_part = hash.sha3_256(prefix) |> bytearray.take(4)

  let full_name =
    base_token_part
      |> bytearray.concat(prefix_part)
      |> bytearray.concat(postfix)

  full_name
}

pub fn extract_token_base(token_name: ByteArray) -> ByteArray {
  expect is_valid_token_name(token_name)?
  token_name |> bytearray.take(20)
}

pub fn extract_token_prefix(token_name: ByteArray) -> ByteArray {
  expect is_valid_token_name(token_name)?
  token_name |> bytearray.slice(20, 23)
}

pub fn extract_token_sequence(token_name: ByteArray) -> Option<ByteArray> {
  if is_valid_token_name(token_name) {
    let postfix = bytearray.drop(token_name, 24)

    Some(postfix)
  } else {
    None
  }
}

fn is_valid_token_name(token_name: ByteArray) -> Bool {
  bytearray.length(token_name) > 24
}
