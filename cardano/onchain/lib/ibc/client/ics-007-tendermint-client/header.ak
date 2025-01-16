use ibc/client/ics_007_tendermint_client/cometbft/block/commit as commit_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle

pub type Header {
  signed_header: SignedHeader,
  validator_set: ValidatorSet,
  trusted_height: Height,
  trusted_validators: ValidatorSet,
}

/// consensus_state returns the updated consensus state associated with the header
pub fn consensus_state(h: Header) -> ConsensusState {
  let Header { signed_header, .. } = h
  let SignedHeader { header, .. } = signed_header
  let TmHeader { time, next_validators_hash, app_hash, .. } = header
  ConsensusState {
    timestamp: time,
    next_validators_hash,
    root: merkle.new_merkle_root(app_hash),
  }
}

/// get_height returns the current height.
pub fn get_height(h: Header) -> Height {
  let Header { signed_header, .. } = h
  let SignedHeader { header, .. } = signed_header
  let TmHeader { chain_id, height, .. } = header
  let revision = height.parse_chain_id(chain_id)
  height.new_height(revision, height)
}

/// get_time returns the current block timestamp.
pub fn get_time(h: Header) -> Int {
  let Header { signed_header, .. } = h
  let SignedHeader { header, .. } = signed_header
  let TmHeader { time, .. } = header
  time
}

pub fn null_header() -> Header {
  Header {
    signed_header: SignedHeader {
      header: tm_header_mod.null_tm_header(),
      commit: commit_mod.null_commit(),
    },
    validator_set: ValidatorSet {
      validators: [],
      proposer: Validator {
        address: "",
        pubkey: "",
        voting_power: 0,
        proposer_priority: 0,
      },
      total_voting_power: 0,
    },
    trusted_height: Height { revision_number: 0, revision_height: 0 },
    trusted_validators: ValidatorSet {
      validators: [],
      proposer: Validator {
        address: "",
        pubkey: "",
        voting_power: 0,
        proposer_priority: 0,
      },
      total_voting_power: 0,
    },
  }
}
