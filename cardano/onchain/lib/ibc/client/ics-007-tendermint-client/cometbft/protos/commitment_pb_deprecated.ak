use aiken/builtin.{add_integer as add, if_then_else as ite}
use aiken/option.{is_none}
use aiken/primitive/bytearray.{concat, length, push}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/utils/bytes.{encode_varint, sov}

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
                |> encode_varint()
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
                l |> sov() |> add(l + 1)
              },
            ),
          )
    },
  )
}
