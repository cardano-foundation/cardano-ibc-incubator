use ibc/client/ics_007_tendermint_client/cometbft/block/block_id as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{
  TmHeader, validate_basic,
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
