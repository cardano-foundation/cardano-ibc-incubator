use aiken/bytearray.{concat, length}
use aiken/int
use ibc/apps/transfer/types/ibc_trace
use ibc/utils/string

pub type FungibleTokenPacketData {
  /// the token denomination to be transferred
  denom: ByteArray,
  /// the token amount to be transferred
  amount: ByteArray,
  /// the sender address
  sender: ByteArray,
  /// the recipient address on the destination chain
  receiver: ByteArray,
  /// optional memo
  memo: ByteArray,
}

pub fn validate_basic(ftpd: FungibleTokenPacketData) -> Bool {
  when int.from_utf8(ftpd.amount) is {
    Some(amount) -> and {
        amount > 0,
        string.trim_space(ftpd.sender) != "",
        string.trim_space(ftpd.receiver) != "",
        ibc_trace.validate_prefixed_denom(ftpd.denom),
      }
    None -> False
  }
}

pub fn get_bytes(ftpd: FungibleTokenPacketData) -> ByteArray {
  let FungibleTokenPacketData { amount, denom, memo, receiver, sender } = ftpd
  #[]
    |> concat("{")
    |> concat(
         if length(amount) == 0 {
           ""
         } else {
           get_json("amount", amount) |> concat(",")
         },
       )
    |> concat(
         if length(denom) == 0 {
           ""
         } else {
           get_json("denom", denom) |> concat(",")
         },
       )
    |> concat(
         if length(memo) == 0 {
           ""
         } else {
           get_json("memo", memo) |> concat(",")
         },
       )
    |> concat(
         if length(receiver) == 0 {
           ""
         } else {
           get_json("receiver", receiver) |> concat(",")
         },
       )
    |> concat(
         if length(sender) == 0 {
           ""
         } else {
           get_json("sender", sender)
         },
       )
    |> concat("}")
}

fn get_json(key: ByteArray, value: ByteArray) -> ByteArray {
  #[]
    |> concat("\"")
    |> concat(key)
    |> concat("\"")
    |> concat(":")
    |> concat("\"")
    |> concat(value)
    |> concat("\"")
}
