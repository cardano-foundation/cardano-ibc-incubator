use aiken/builtin.{if_then_else as ite}
use aiken/bytearray.{concat, length, push}
use aiken/hash.{Hash, Sha3_256}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
} as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/canonical.{
  canonicalize_block_id,
}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_chain_id_len, tm_hash_size,
}
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree.{
  hash_from_byte_slices_sha2_256,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/canonical_pb.{
  marshal_for_block_id,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/timestamp_pb.{
  marshal_for_timestamp, timestamp_proto,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{
  Consensus, marshal_for_consensus,
}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/utils/bytes.{encode_varint}
use ibc/utils/int.{uint64}

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

pub fn hash(h: TmHeader) -> ByteArray {
  ite(
    length(h.validators_hash) == 0,
    #[],
    {
      let TmHeader {
        version,
        chain_id,
        height,
        time,
        last_block_id,
        last_commit_hash,
        data_hash,
        validators_hash,
        next_validators_hash,
        consensus_hash,
        app_hash,
        last_results_hash,
        evidence_hash,
        proposer_address,
      } = h
      let hbz = version |> Some() |> marshal_for_consensus()
      let pbt = time |> timestamp_proto() |> marshal_for_timestamp()
      let bzbi =
        last_block_id
          |> canonicalize_block_id()
          |> Some()
          |> marshal_for_block_id()

      hash_from_byte_slices_sha2_256(
        [
          hbz,
          ite(
            length(chain_id) == 0,
            #[],
            chain_id
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(chain_id)
              |> push(10),
          ),
          ite(
            height == 0,
            #[],
            height |> uint64() |> encode_varint() |> push(8),
          ),
          pbt,
          bzbi,
          ite(
            length(last_commit_hash) == 0,
            #[],
            last_commit_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(last_commit_hash)
              |> push(10),
          ),
          ite(
            length(data_hash) == 0,
            #[],
            data_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(data_hash)
              |> push(10),
          ),
          ite(
            length(validators_hash) == 0,
            #[],
            validators_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(validators_hash)
              |> push(10),
          ),
          ite(
            length(next_validators_hash) == 0,
            #[],
            next_validators_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(next_validators_hash)
              |> push(10),
          ),
          ite(
            length(consensus_hash) == 0,
            #[],
            consensus_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(consensus_hash)
              |> push(10),
          ),
          ite(
            length(app_hash) == 0,
            #[],
            app_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(app_hash)
              |> push(10),
          ),
          ite(
            length(last_results_hash) == 0,
            #[],
            last_results_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(last_results_hash)
              |> push(10),
          ),
          ite(
            length(evidence_hash) == 0,
            #[],
            evidence_hash
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(evidence_hash)
              |> push(10),
          ),
          ite(
            length(proposer_address) == 0,
            #[],
            proposer_address
              |> length()
              |> uint64()
              |> encode_varint()
              |> concat(proposer_address)
              |> push(10),
          ),
        ],
      )
    },
  )
}

fn validate_hash(h: ByteArray) -> Bool {
  let len = h |> bytearray.length()
  len == 0 || len == tm_hash_size
}

test test_tmheader_hash() {
  let tmheader =
    TmHeader {
      version: Consensus { block: 1, app: 2 },
      chain_id: "chainId",
      height: 3,
      time: 1715282423 * 1_000_000_000 + 300358000,
      last_block_id: BlockID {
        hash: #[4, 5, 6],
        part_set_header: PartSetHeader { total: 7, hash: #[8, 9, 10] },
      },
      last_commit_hash: #[11],
      data_hash: #[12],
      validators_hash: #[13],
      next_validators_hash: #[14],
      consensus_hash: #[15],
      app_hash: #[16],
      last_results_hash: #[17],
      evidence_hash: #[18],
      proposer_address: #[19],
    }
  hash(tmheader) == #"f6809c55c6e77bb067268253dcb2ca6e570846f88e4d48d80db0deb80ebaf33d"
}
