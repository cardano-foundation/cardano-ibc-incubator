use ibc/client/ics_007_tendermint_client/cometbft/constants.{tm_hash_size}
use ibc/utils/bytes.{is_empty_or_size}

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
  and {
    is_empty_or_size(block_id.hash, tm_hash_size),
    is_empty_or_size(block_id.part_set_header.hash, tm_hash_size),
    block_id.part_set_header.total >= 0,
  }
}
