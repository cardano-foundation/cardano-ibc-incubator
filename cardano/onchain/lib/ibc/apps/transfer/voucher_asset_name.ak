use aiken/crypto
use aiken/primitive/bytearray

pub const cip67_reference_nft_label = #"000643b0"
pub const cip67_ft_label = #"0014df10"
pub const voucher_denom_hash_length = 28
pub const labeled_voucher_token_name_length = 32

pub fn voucher_denom_hash(full_denom: ByteArray) -> ByteArray {
  crypto.blake2b_224(full_denom)
}

pub fn voucher_user_token_name(full_denom: ByteArray) -> ByteArray {
  voucher_denom_hash(full_denom) |> voucher_user_token_name_from_denom_hash
}

pub fn voucher_reference_token_name(full_denom: ByteArray) -> ByteArray {
  voucher_denom_hash(full_denom) |> voucher_reference_token_name_from_denom_hash
}

pub fn voucher_user_token_name_from_denom_hash(
  voucher_denom_hash: ByteArray,
) -> ByteArray {
  expect bytearray.length(voucher_denom_hash) == voucher_denom_hash_length
  bytearray.concat(cip67_ft_label, voucher_denom_hash)
}

pub fn voucher_reference_token_name_from_denom_hash(
  voucher_denom_hash: ByteArray,
) -> ByteArray {
  expect bytearray.length(voucher_denom_hash) == voucher_denom_hash_length
  bytearray.concat(cip67_reference_nft_label, voucher_denom_hash)
}

pub fn is_voucher_user_token_name(token_name: ByteArray) -> Bool {
  bytearray.length(token_name) == labeled_voucher_token_name_length &&
    bytearray.take(token_name, 4) == cip67_ft_label
}

pub fn is_voucher_reference_token_name(token_name: ByteArray) -> Bool {
  bytearray.length(token_name) == labeled_voucher_token_name_length &&
    bytearray.take(token_name, 4) == cip67_reference_nft_label
}

pub fn strip_label(token_name: ByteArray) -> ByteArray {
  expect bytearray.length(token_name) == labeled_voucher_token_name_length
  bytearray.drop(token_name, 4)
}
