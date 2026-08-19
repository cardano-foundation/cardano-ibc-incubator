use aiken/builtin.{if_then_else as ite}
use aiken/crypto.{Hash, Sha3_256}
use aiken/primitive/bytearray.{concat, length, push}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID} as block_id_mod
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
use ibc/utils/bytes.{encode_varint, is_empty_or_size}
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
  and {
    header.version.block == block_protocol,
    bytearray.length(header.chain_id) <= max_chain_id_len,
    header.height > 0,
    block_id_mod.validate_basic(header.last_block_id),
    is_empty_or_size(header.last_commit_hash, tm_hash_size),
    is_empty_or_size(header.data_hash, tm_hash_size),
    is_empty_or_size(header.evidence_hash, tm_hash_size),
    is_empty_or_size(header.next_validators_hash, tm_hash_size),
    // AddressSize = 20
    is_empty_or_size(header.proposer_address, 20),
    is_empty_or_size(header.validators_hash, tm_hash_size),
    is_empty_or_size(header.next_validators_hash, tm_hash_size),
    is_empty_or_size(header.consensus_hash, tm_hash_size),
    is_empty_or_size(header.last_results_hash, tm_hash_size),
    header.time > 0,
  }
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

fn encode_length_delimited_field(value: ByteArray) -> ByteArray {
  if value == #[] {
    #[]
  } else {
    let value_length = length(value)
    let encoded_length =
      if value_length < 128 {
        push(#[], value_length)
      } else {
        encode_varint(value_length)
      }
    encoded_length
      |> concat(value)
      |> push(bytes.field_1_length_delimited)
  }
}

pub fn hash(h: TmHeader) -> ByteArray {
  ite(
    h.validators_hash == #[],
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
      let hbz = version |> marshal_for_consensus()
      let ts_opt = time |> timestamp_proto()
      let pbt =
        when ts_opt is {
          Some(ts) -> marshal_for_timestamp(ts).2nd
          _ -> #""
        }

      let (_, bzbi) =
        last_block_id
          |> canonicalize_block_id()
          |> marshal_for_block_id()

      hash_from_byte_slices_sha2_256(
        [
          hbz.2nd,
          encode_length_delimited_field(chain_id),
          ite(
            height == 0,
            #[],
            height |> uint64() |> encode_varint() |> push(bytes.field_1_varint),
          ),
          pbt,
          bzbi,
          encode_length_delimited_field(last_commit_hash),
          encode_length_delimited_field(data_hash),
          encode_length_delimited_field(validators_hash),
          encode_length_delimited_field(next_validators_hash),
          encode_length_delimited_field(consensus_hash),
          encode_length_delimited_field(app_hash),
          encode_length_delimited_field(last_results_hash),
          encode_length_delimited_field(evidence_hash),
          encode_length_delimited_field(proposer_address),
        ],
      )
    },
  )
}
