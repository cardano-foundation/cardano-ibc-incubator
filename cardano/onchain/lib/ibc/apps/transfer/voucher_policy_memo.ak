use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/assets.{PolicyId}
use ibc/apps/transfer/voucher_metadata.{ascii_lower}

pub const voucher_policy_memo_prefix = "cardano-ibc:voucher-policy:"

pub fn marker(policy_id: PolicyId) -> ByteArray {
  voucher_policy_memo_prefix
    |> bytearray.concat(
        policy_id
          |> bytearray.to_hex
          |> string.to_bytearray
          |> ascii_lower,
      )
}

pub fn matches(memo: ByteArray, policy_id: PolicyId) -> Bool {
  memo == marker(policy_id)
}
