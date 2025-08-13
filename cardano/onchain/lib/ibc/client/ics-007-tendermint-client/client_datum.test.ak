use aiken/collection/list
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle

const mock_chain_id = "sidechain-0"

const mock_auth_token_policy_id =
  #"505d7e26586b54e1f54cbe5f5854254d559549f9d5a3ba3545515831"

const mock_auth_token_name =
  #"859482829d0fafd675d22c044deec892fa6a26c51ab6fe5520b09991d12fa3d2"

const mock_trusting_period = 1000

const mock_unbonding_period = 1001

const mock_max_clock_drift = 1

const mock_timestamp = 1000

const mock_next_validators_hash =
  #"92dad9443e4dd6d70a7f11872101ebff87e21798e4fbb26fa4bf590eb440e71b"

const mock_app_hash =
  #"67e58e47576a6fea2d127f9287205a8c789e4d822171064920e1081136e02816"

const mock_round = 1

const expected_time = 1705552992062000

const expected_next_validators_hash =
  #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"

const expected_app_hash =
  #"92dad9443e4dd6d70a7f11872101ebff87e21798e4fbb26fa4bf590eb440e71b"

fn get_mock_header(latest_height: Height) -> Header {
  Header {
    signed_header: SignedHeader {
      header: tm_header.TmHeader {
        ..tm_header.null_tm_header(),
        chain_id: "ogmosis",
        height: latest_height.revision_height,
        time: expected_time,
        validators_hash: "",
        next_validators_hash: expected_next_validators_hash,
        app_hash: expected_app_hash,
      },
      commit: Commit {
        height: latest_height.revision_height,
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

fn get_mock_client_datum(latest_height: Height) -> ClientDatum {
  let mock_client_state =
    client_state.new_client_state(
      mock_chain_id,
      unchecked_rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      latest_height,
      [],
    )

  let mock_consensus_states =
    [
      Pair(
        latest_height,
        ConsensusState {
          timestamp: mock_timestamp,
          next_validators_hash: mock_next_validators_hash,
          root: merkle.new_merkle_root(mock_app_hash),
        },
      ),
    ]

  let mock_auth_token =
    AuthToken {
      policy_id: mock_auth_token_policy_id,
      name: mock_auth_token_name,
    }
  ClientDatum {
    state: ClientDatumState {
      client_state: mock_client_state,
      consensus_states: mock_consensus_states,
    },
    token: mock_auth_token,
  }
}

// Unit test with success case for is_initialized_valid function
// NOTE: Will use not null proof specs for test case after resolving validate's TODO part
test test_is_initialized_valid_success() {
  let mock_latest_height = Height { revision_number: 0, revision_height: 8 }
  let mock_client_state =
    client_state.new_client_state(
      mock_chain_id,
      unchecked_rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )

  let mock_consensus_states =
    [
      Pair(
        mock_latest_height,
        ConsensusState {
          timestamp: mock_timestamp,
          next_validators_hash: mock_next_validators_hash,
          root: merkle.new_merkle_root(mock_app_hash),
        },
      ),
    ]

  let mock_auth_token =
    AuthToken {
      policy_id: mock_auth_token_policy_id,
      name: mock_auth_token_name,
    }
  let mock_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: mock_client_state,
        consensus_states: mock_consensus_states,
      },
      token: mock_auth_token,
    }

  client_datum.is_initialized_valid(mock_datum, mock_auth_token) == True
}

// Unit tests with failure cases for is_initialized_valid function
// NOTE: Will use not null proof specs for test case after resolving validate's TODO part

// invalid client state of the datum
test test_is_initialized_valid_fail_with_invalid_client_state() fail {
  let invalid_chain_id = "   "
  let mock_latest_height = Height { revision_number: 0, revision_height: 8 }
  let mock_client_state =
    client_state.new_client_state(
      invalid_chain_id,
      unchecked_rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )

  let mock_consensus_states =
    [
      Pair(
        mock_latest_height,
        ConsensusState {
          timestamp: mock_timestamp,
          next_validators_hash: mock_next_validators_hash,
          root: merkle.new_merkle_root(mock_app_hash),
        },
      ),
    ]

  let mock_auth_token =
    AuthToken {
      policy_id: mock_auth_token_policy_id,
      name: mock_auth_token_name,
    }
  let mock_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: mock_client_state,
        consensus_states: mock_consensus_states,
      },
      token: mock_auth_token,
    }

  client_datum.is_initialized_valid(mock_datum, mock_auth_token) == True
}

// invalid consensus states of the datum
test test_is_initialized_valid_fail_with_invalid_consensus_states() fail {
  let mock_latest_height = Height { revision_number: 0, revision_height: 8 }
  let mock_client_state =
    client_state.new_client_state(
      mock_chain_id,
      unchecked_rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )
  let mock_consensus_states = []
  let mock_auth_token =
    AuthToken {
      policy_id: mock_auth_token_policy_id,
      name: mock_auth_token_name,
    }
  let mock_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: mock_client_state,
        consensus_states: mock_consensus_states,
      },
      token: mock_auth_token,
    }

  client_datum.is_initialized_valid(mock_datum, mock_auth_token) == True
}

// invalid token of the datum
test test_is_initialized_valid_fail_with_invalid_datum_token() fail {
  let mock_latest_height = Height { revision_number: 0, revision_height: 8 }
  let mock_client_state =
    client_state.new_client_state(
      mock_chain_id,
      unchecked_rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )
  let mock_consensus_states =
    [
      Pair(
        mock_latest_height,
        ConsensusState {
          timestamp: mock_timestamp,
          next_validators_hash: mock_next_validators_hash,
          root: merkle.new_merkle_root(mock_app_hash),
        },
      ),
    ]
  let mock_auth_token =
    AuthToken {
      policy_id: mock_auth_token_policy_id,
      name: mock_auth_token_name,
    }
  let mock_invalid_auth_token =
    AuthToken {
      policy_id: mock_auth_token_policy_id,
      name: "invalid_auth_token",
    }
  let mock_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: mock_client_state,
        consensus_states: mock_consensus_states,
      },
      token: mock_invalid_auth_token,
    }

  client_datum.is_initialized_valid(mock_datum, mock_auth_token) == True
}

// The input consensus_states do not contain the key that corresponds to the header height.
// The latest height of the input client_state is less than the header height.
// The output consensus_states has one more element than the input consensus_states, which is the header consensus_states.
// The header_height is equal to the latest height of the output client_state.
// All other elements of the input and output datum must be equal.
test test_update_state_succeed_01() {
  let mock_header_latest_height =
    Height { revision_number: 0, revision_height: 100 }
  let mock_input_latest_height =
    Height { revision_number: 0, revision_height: 99 }
  let mock_client_datum = get_mock_client_datum(mock_input_latest_height)
  let mock_header = get_mock_header(mock_header_latest_height)
  let input_client_datum = mock_client_datum
  let output_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        consensus_states: [
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
          ..mock_client_datum.state.consensus_states
        ],
        client_state: ClientState {
          ..mock_client_datum.state.client_state,
          latest_height: mock_header_latest_height,
        },
      },
    }
  client_datum.update_state(
    input_client_datum,
    output_client_datum,
    mock_header,
    0,
  )
}

// The input consensus_states do not contain the key that corresponds to the header height.
// The latest height of the input client_state greater than or equal the header height.
// The output consensus_states has one more element than the input consensus_states, which is the header consensus_states.
// All other elements of the input and output datum must be equal.
test test_update_state_succeed_02() {
  let mock_header_latest_height =
    Height { revision_number: 0, revision_height: 100 }
  let mock_input_latest_height =
    Height { revision_number: 0, revision_height: 101 }
  let mock_client_datum = get_mock_client_datum(mock_input_latest_height)
  let mock_header = get_mock_header(mock_header_latest_height)
  let input_client_datum = mock_client_datum
  let output_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        ..mock_client_datum.state,
        consensus_states: [
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
          ..mock_client_datum.state.consensus_states
        ],
      },
    }
  client_datum.update_state(
    input_client_datum,
    output_client_datum,
    mock_header,
    0,
  )
}

/// Prune timeout consensus states.
test test_update_state_succeed_03() {
  let mock_header_latest_height =
    Height { revision_number: 0, revision_height: 100 }
  let mock_input_latest_height =
    Height { revision_number: 0, revision_height: 101 }
  let mock_client_datum = get_mock_client_datum(mock_input_latest_height)
  let mock_header = get_mock_header(mock_header_latest_height)

  let pruned_cons_state =
    ConsensusState {
      timestamp: 1710908451898 * 1_000_000,
      next_validators_hash: mock_next_validators_hash,
      root: merkle.new_merkle_root(mock_app_hash),
    }
  let mock_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        ..mock_client_datum.state,
        consensus_states: [
          Pair(
            Height { revision_number: 0, revision_height: 88 },
            pruned_cons_state,
          ),
          ..mock_client_datum.state.consensus_states
        ],
      },
    }
  let tx_valid_from =
    (
      pruned_cons_state.timestamp + mock_client_datum.state.client_state.trusting_period
    ) / 1_000_000 - 100000000

  let expected_cons_state =
    list.filter(
      mock_client_datum.state.consensus_states,
      fn(item) {
        !client_state.is_expired(
          mock_client_datum.state.client_state,
          item.2nd.timestamp,
          tx_valid_from * 1_000_000,
        )
      },
    )
      |> list.push(
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
        )

  let input_client_datum = mock_client_datum
  let output_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        ..mock_client_datum.state,
        consensus_states: expected_cons_state,
      },
    }
  client_datum.update_state(
    input_client_datum,
    output_client_datum,
    mock_header,
    tx_valid_from,
  )
}

/// Header height is less or equal than input client state latest height
/// but the output client state latest height is updated to header height
test test_update_state_return_false_01() {
  let mock_header_latest_height =
    Height { revision_number: 0, revision_height: 100 }
  let mock_input_latest_height =
    Height { revision_number: 0, revision_height: 101 }
  let mock_client_datum = get_mock_client_datum(mock_input_latest_height)
  let mock_header = get_mock_header(mock_header_latest_height)
  let input_client_datum = mock_client_datum
  let output_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        consensus_states: [
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
          ..mock_client_datum.state.consensus_states
        ],
        client_state: ClientState {
          ..mock_client_datum.state.client_state,
          latest_height: mock_header_latest_height,
        },
      },
    }
  !client_datum.update_state(
    input_client_datum,
    output_client_datum,
    mock_header,
    0,
  )
}

/// Header height is greater than input client state latest height
/// but the output client state latest height is not updated
test test_update_state_return_false_02() {
  let mock_header_latest_height =
    Height { revision_number: 0, revision_height: 100 }
  let mock_input_latest_height =
    Height { revision_number: 0, revision_height: 99 }
  let mock_client_datum = get_mock_client_datum(mock_input_latest_height)
  let mock_header = get_mock_header(mock_header_latest_height)
  let input_client_datum = mock_client_datum
  let output_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        ..mock_client_datum.state,
        consensus_states: [
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
          ..mock_client_datum.state.consensus_states
        ],
      },
    }
  !client_datum.update_state(
    input_client_datum,
    output_client_datum,
    mock_header,
    0,
  )
}

//The input consensus_states contain the key that corresponds to the header height.
test test_update_state_fail_when_input_consensus_state_contain_header_height_key() fail {
  let mock_header_latest_height =
    Height { revision_number: 0, revision_height: 100 }
  let mock_input_latest_height =
    Height { revision_number: 0, revision_height: 101 }
  let mock_client_datum = get_mock_client_datum(mock_input_latest_height)
  let mock_header = get_mock_header(mock_header_latest_height)
  let input_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        ..mock_client_datum.state,
        consensus_states: [
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
          ..mock_client_datum.state.consensus_states
        ],
      },
    }
  let output_client_datum =
    ClientDatum {
      ..mock_client_datum,
      state: ClientDatumState {
        ..mock_client_datum.state,
        consensus_states: [
          Pair(
            header.get_height(mock_header),
            header.consensus_state(mock_header),
          ),
          ..mock_client_datum.state.consensus_states
        ],
      },
    }
  client_datum.update_state(
    input_client_datum,
    output_client_datum,
    mock_header,
    0,
  )
}
