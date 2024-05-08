use aiken/bytearray
use aiken/hash.{Hash, Sha3_256}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID} as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_chain_id_len, tm_hash_size,
}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  Consensus, block_protocol,
}

pub type TmHeader {
  // basic block info
  version: Consensus,
  chain_id: ByteArray,
  height: Int,
  time: Int,
  // prev block info
  last_block_id: BlockID,
  // hashes of block data
  last_commit_hash: ByteArray,
  data_hash: ByteArray,
  // hashes from the app output from the prev block
  validators_hash: Hash<Sha3_256, ValidatorSet>,
  next_validators_hash: Hash<Sha3_256, ValidatorSet>,
  consensus_hash: ByteArray,
  app_hash: ByteArray,
  // root hash of all results from the txs from the previous block
  last_results_hash: ByteArray,
  // consensus info
  evidence_hash: ByteArray,
  proposer_address: ByteArray,
}

pub fn validate_basic(header: TmHeader) -> Bool {
  expect header.version.block == block_protocol

  expect bytearray.length(header.chain_id) <= max_chain_id_len

  expect header.height > 0

  expect block_id_mod.validate_basic(header.last_block_id)

  expect validate_hash(header.last_commit_hash)

  expect validate_hash(header.data_hash)

  expect validate_hash(header.evidence_hash)

  expect validate_hash(header.next_validators_hash)

  // AddressSize = 20
  expect bytearray.length(header.proposer_address) == 20

  expect validate_hash(header.validators_hash)

  expect validate_hash(header.next_validators_hash)

  expect validate_hash(header.consensus_hash)

  expect validate_hash(header.last_results_hash)

  expect header.time > 0

  True
}

pub fn null_tm_header() -> TmHeader {
  TmHeader {
    version: Consensus { block: 0, app: 0 },
    chain_id: "",
    height: 0,
    time: 0,
    last_block_id: block_id_mod.null_block_id(),
    last_commit_hash: "",
    data_hash: "",
    validators_hash: "",
    next_validators_hash: "",
    consensus_hash: "",
    app_hash: "",
    last_results_hash: "",
    evidence_hash: "",
    proposer_address: "",
  }
}

pub fn hash(_h: TmHeader) -> ByteArray {
  // TODO: Add hashing logic
  ""
}

fn validate_hash(h: ByteArray) -> Bool {
  let len = h |> bytearray.length()
  len == 0 || len == tm_hash_size
}
