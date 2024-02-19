use aiken/dict
use aiken/math/rational
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
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

// Unit test with success case for is_initialized_valid function
// NOTE: Will use not null proof specs for test case after resolving validate's TODO part
test test_is_initialized_valid_success() {
  let mock_latest_height = Height { revision_number: 0, revision_height: 8 }
  let mock_client_state =
    client_state.new_client_state(
      mock_chain_id,
      rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )
  let mock_consensus_states =
    dict.new()
      |> dict.insert(
           mock_latest_height,
           ConsensusState {
             timestamp: mock_timestamp,
             next_validators_hash: mock_next_validators_hash,
             root: merkle.new_merkle_root(mock_app_hash),
           },
           height.compare,
         )
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
      rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )
  let mock_consensus_states =
    dict.new()
      |> dict.insert(
           mock_latest_height,
           ConsensusState {
             timestamp: mock_timestamp,
             next_validators_hash: mock_next_validators_hash,
             root: merkle.new_merkle_root(mock_app_hash),
           },
           height.compare,
         )
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
      rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )
  let mock_consensus_states = dict.new()
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
      rational.from_int(1),
      mock_trusting_period,
      mock_unbonding_period,
      mock_max_clock_drift,
      mock_latest_height,
      [],
    )
  let mock_consensus_states =
    dict.new()
      |> dict.insert(
           mock_latest_height,
           ConsensusState {
             timestamp: mock_timestamp,
             next_validators_hash: mock_next_validators_hash,
             root: merkle.new_merkle_root(mock_app_hash),
           },
           height.compare,
         )
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
