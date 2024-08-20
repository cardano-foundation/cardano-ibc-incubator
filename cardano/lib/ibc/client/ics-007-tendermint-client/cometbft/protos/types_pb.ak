use aiken/builtin.{if_then_else as ite}
use aiken/bytearray.{concat, push}
use aiken/option.{is_none}
use ibc/utils/bytes.{encode_varint}
use ibc/utils/int.{uint64}

pub type Consensus {
  block: Int,
  app: Int,
}

pub fn marshal_for_consensus(consensus_opt: Option<Consensus>) -> ByteArray {
  ite(
    is_none(consensus_opt),
    #[],
    {
      expect Some(consensus) = consensus_opt
      let Consensus { block, app } = consensus
      #[]
        |> concat(
            ite(
              block == 0,
              #[],
              block |> uint64() |> encode_varint() |> push(8),
            ),
          )
        |> concat(
            ite(app == 0, #[], app |> uint64() |> encode_varint() |> push(0x10)),
          )
    },
  )
}
