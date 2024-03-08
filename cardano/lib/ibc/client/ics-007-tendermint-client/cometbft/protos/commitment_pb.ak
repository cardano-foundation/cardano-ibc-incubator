// DO NOT EDIT.
// source: ibc/core/commitment/v1/commitment.proto

use aiken/builtin.{
  add_integer as add, divide_integer as div, if_then_else as ite,
}
use aiken/bytearray.{concat, length, push}
use aiken/option.{is_none}
use ibc/utils/bits.{band, bor, len64, shl, shr}
use ibc/utils/int.{Int64, uint64}

pub type MerkleRoot {
  hash: ByteArray,
}

pub type MerklePrefix {
  key_prefix: ByteArray,
}

pub type MerklePath {
  key_path: List<ByteArray>,
}

pub fn marshal_for_merkle_prefix(
  merkle_prefix_opt: Option<MerklePrefix>,
) -> ByteArray {
  ite(
    is_none(merkle_prefix_opt),
    #[],
    {
      expect Some(merkle_prefix) = merkle_prefix_opt
      let MerklePrefix { key_prefix } = merkle_prefix
      #[]
        |> concat(
             ite(
               length(key_prefix) == 0,
               #[],
               key_prefix
                 |> length()
                 |> uint64()
                 |> encode_varint_commitment()
                 |> concat(key_prefix)
                 |> push(10),
             ),
           )
    },
  )
}

pub fn size_for_merkle_prefix(merkle_prefix_opt: Option<MerklePrefix>) -> Int {
  ite(
    is_none(merkle_prefix_opt),
    0,
    {
      expect Some(merkle_prefix) = merkle_prefix_opt
      let MerklePrefix { key_prefix } = merkle_prefix
      0
        |> add(
             ite(
               length(key_prefix) == 0,
               0,
               {
                 let l = length(key_prefix)
                 l |> uint64() |> sov_commitment() |> add(l + 1)
               },
             ),
           )
    },
  )
}

fn encode_varint_commitment(v: Int64) -> ByteArray {
  ite(
    v >= ( 1 |> shl(7) ),
    v
      |> shr(7)
      |> encode_varint_commitment()
      |> push(
           v
             |> band(0x7f)
             |> bor(0x80),
         ),
    #[] |> push(v),
  )
}

fn sov_commitment(x: Int64) -> Int {
  x |> bor(1) |> len64() |> add(6) |> div(7)
}
