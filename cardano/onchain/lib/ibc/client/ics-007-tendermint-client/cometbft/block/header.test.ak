use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
} as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{
  TmHeader, hash, validate_basic,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}

test test_validate_basic_success() {
  validate_basic(
    TmHeader {
      version: Consensus { block: 11, app: 0 },
      chain_id: #"",
      height: 1,
      time: 1,
      last_block_id: block_id_mod.null_block_id(),
      last_commit_hash: #"",
      data_hash: #"",
      validators_hash: #"",
      next_validators_hash: #"",
      consensus_hash: #"",
      app_hash: #"",
      last_results_hash: #"",
      evidence_hash: #"",
      proposer_address: #"0123456789012345678901234567890123456789",
    },
  )
}

test test_validate_basic_fails_chain_id_too_long() {
  !validate_basic(
    TmHeader {
      version: Consensus { block: 11, app: 0 },
      chain_id: #"012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789",
      height: 1,
      time: 1,
      last_block_id: block_id_mod.null_block_id(),
      last_commit_hash: #"",
      data_hash: #"",
      validators_hash: #"",
      next_validators_hash: #"",
      consensus_hash: #"",
      app_hash: #"",
      last_results_hash: #"",
      evidence_hash: #"",
      proposer_address: #"0123456789012345678901234567890123456789",
    },
  )
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
