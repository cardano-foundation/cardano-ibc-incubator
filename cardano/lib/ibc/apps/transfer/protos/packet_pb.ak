// DO NOT EDIT.
// source: ibc/applications/transfer/v2/packet.proto

use aiken/builtin.{if_then_else as ite}
use aiken/bytearray.{concat, length, push}
use aiken/option.{is_none}
use ibc/utils/bytes.{encode_varint}
use ibc/utils/int.{uint64}

pub type FungibleTokenPacketDataPb {
  denom: ByteArray,
  amount: ByteArray,
  sender: ByteArray,
  receiver: ByteArray,
  memo: ByteArray,
}

pub fn get_bytes(ftpd: FungibleTokenPacketDataPb) -> ByteArray {
  let FungibleTokenPacketDataPb { amount, denom, memo, receiver, sender } = ftpd
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

pub fn get_json(key: ByteArray, value: ByteArray) -> ByteArray {
  #[]
    |> concat("\"")
    |> concat(key)
    |> concat("\"")
    |> concat(":")
    |> concat("\"")
    |> concat(value)
    |> concat("\"")
}

pub fn marshal_for_fungbile_token_packet_data(
  ftpd_opt: Option<FungibleTokenPacketDataPb>,
) -> ByteArray {
  ite(
    is_none(ftpd_opt),
    #[],
    {
      expect Some(ftpd) = ftpd_opt
      let FungibleTokenPacketDataPb { denom, amount, sender, receiver, memo } =
        ftpd
      #[]
        |> concat(
             ite(
               length(denom) == 0,
               #[],
               denom
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(denom)
                 |> push(10),
             ),
           )
        |> concat(
             ite(
               length(amount) == 0,
               #[],
               amount
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(amount)
                 |> push(0x12),
             ),
           )
        |> concat(
             ite(
               length(sender) == 0,
               #[],
               sender
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(sender)
                 |> push(0x1a),
             ),
           )
        |> concat(
             ite(
               length(receiver) == 0,
               #[],
               receiver
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(receiver)
                 |> push(0x22),
             ),
           )
        |> concat(
             ite(
               length(memo) == 0,
               #[],
               memo
                 |> length()
                 |> uint64()
                 |> encode_varint()
                 |> concat(memo)
                 |> push(0x2a),
             ),
           )
    },
  )
}
