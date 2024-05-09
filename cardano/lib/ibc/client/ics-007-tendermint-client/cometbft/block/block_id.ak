use aiken/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/constants.{tm_hash_size}

pub type BlockID {
  hash: ByteArray,
  part_set_header: PartSetHeader,
}

pub type PartSetHeader {
  total: Int,
  hash: ByteArray,
}

pub fn null_block_id() -> BlockID {
  BlockID { hash: "", part_set_header: PartSetHeader { total: 0, hash: "" } }
}

pub fn validate_basic(block_id: BlockID) -> Bool {
  expect validate_hash(block_id.hash)

  expect validate_hash(block_id.part_set_header.hash)

  expect block_id.part_set_header.total >= 0

  True
}

fn validate_hash(h: ByteArray) -> Bool {
  let len = h |> bytearray.length()
  len == 0 || len == tm_hash_size
}
