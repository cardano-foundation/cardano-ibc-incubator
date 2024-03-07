use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{
  BlockID, Commit, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

const expected_revision_height = 99

const mock_round = 1

const expected_time = 1705552992062000

const expected_next_validators_hash =
  #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"

const expected_app_hash =
  #"92dad9443e4dd6d70a7f11872101ebff87e21798e4fbb26fa4bf590eb440e71b"

fn get_sample_header() -> Header {
  Header {
    signed_header: SignedHeader {
      header: tm_header.TmHeader {
        chain_id: "ogmosis",
        height: expected_revision_height,
        time: expected_time,
        validators_hash: "",
        next_validators_hash: expected_next_validators_hash,
        app_hash: expected_app_hash,
      },
      commit: Commit {
        height: expected_revision_height,
        round: mock_round,
        block_id: BlockID {
          hash: "",
          part_set_header: PartSetHeader { total: 0, hash: "" },
        },
        signatures: [],
      },
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
    trusted_height: Height { revision_number: 0, revision_height: 10 },
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

test test_get_height() {
  let h = get_sample_header()
  let revision_number =
    h.signed_header.header.chain_id |> height.parse_chain_id()
  header.get_height(h) == Height {
    revision_number,
    revision_height: expected_revision_height,
  }
}

test test_get_time() {
  let h = get_sample_header()
  header.get_time(h) == expected_time
}

test test_consensus_state() {
  let h = get_sample_header()
  let expected_root = MerkleRoot { hash: expected_app_hash }
  header.consensus_state(h) == ConsensusState {
    timestamp: expected_time,
    next_validators_hash: expected_next_validators_hash,
    root: expected_root,
  }
}
