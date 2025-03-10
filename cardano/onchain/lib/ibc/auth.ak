use aiken/collection/dict
use aiken/crypto
use aiken/primitive/bytearray
use cardano/assets.{AssetName, PolicyId, Value, quantity_of, tokens}
use cardano/transaction.{Output}

pub type AuthToken {
  policy_id: PolicyId,
  name: AssetName,
}

pub fn contain_auth_token(output: Output, token: AuthToken) -> Bool {
  quantity_of(output.value, token.policy_id, token.name) == 1
}

pub fn mint_auth_token(mint: Value, token: AuthToken) -> Bool {
  let minted_tokens = mint |> tokens(token.policy_id)

  minted_tokens == ( dict.empty |> dict.insert(token.name, 1) )
}

pub fn generate_token_name(
  base_token: AuthToken,
  prefix: ByteArray,
  sequence: ByteArray,
) -> ByteArray {
  let postfix = sequence

  expect (bytearray.length(postfix) <= 8)?

  let base_token_part =
    crypto.sha3_256(
      base_token.policy_id
        |> bytearray.concat(base_token.name),
    )
      |> bytearray.take(20)

  let prefix_part = crypto.sha3_256(prefix) |> bytearray.take(4)

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
  trace @"generate_token_name_from_another: postfix": postfix

  expect (bytearray.length(postfix) <= 8)?

  let base_token_part = extract_token_base(another_token_name)

  let prefix_part = crypto.sha3_256(prefix) |> bytearray.take(4)

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

pub fn extract_token_sequence(token_name: ByteArray) -> ByteArray {
  if is_valid_token_name(token_name) {
    let postfix = bytearray.drop(token_name, 24)

    postfix
  } else {
    fail @"Invalid token"
  }
}

fn is_valid_token_name(token_name: ByteArray) -> Bool {
  bytearray.length(token_name) > 24
}
