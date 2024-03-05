use aiken/dict.{Dict}
use aiken/list
use aiken/math/rational
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client.{
  Active, Expired, Frozen, Status,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/utils/time.{Time}

const fifty_char_chain_id = "12345678901234567890123456789012345678901234567890"

const fifty_one_char_chain_id =
  "123456789012345678901234567890123456789012345678901"

const empty_chain_id = ""

// Unit tests with success cases for validate function
// NOTE: Will use not null proof specs for test cases after resolving validate's TODO part
test test_validate_success() {
  let test_cases: List<ClientState> =
    [
      // valid client
      client_state.new_client_state(
        "sidechain-0",
        rational.from_int(1),
        1000,
        1500,
        10,
        Height { revision_number: 0, revision_height: 8 },
        [],
      ),
      // valid chain id
      client_state.new_client_state(
        fifty_char_chain_id,
        rational.from_int(1),
        1000,
        1500,
        10,
        Height { revision_number: 0, revision_height: 8 },
        [],
      ),
    ]

  test_cases
    |> list.all(fn(case) { client_state.validate(case) == True })
}

// Unit tests with failure cases for validate function
// TODO: Need unit tests for cases:
// - invalid revision number
// - proof specs is null/contains null

// invalid chain id - empty chain id
test test_validate_fail_empty_chain_id() fail {
  let cs =
    client_state.new_client_state(
      empty_chain_id,
      rational.from_int(1),
      1000,
      1500,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid chain id - chain id too long
test test_validate_fail_chain_id_too_long() fail {
  let cs =
    client_state.new_client_state(
      fifty_one_char_chain_id,
      rational.from_int(1),
      1000,
      1500,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid trust level
test test_validate_fail_invalid_trust_level() fail {
  expect Some(invalid_trust_level) = rational.new(1, 4)
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      invalid_trust_level,
      1000,
      1500,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid zero trusting period
test test_validate_fail_zero_trusting_period() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      0,
      1500,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid negative trusting period
test test_validate_fail_negative_trusting_period() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      -1,
      1500,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid zero unbonding period
test test_validate_zero_unbonding_period() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1000,
      0,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid negative unbonding period
test test_validate_fail_negative_unbonding_period() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1000,
      -1,
      10,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid zero max clock drift
test test_validate_fail_zero_max_clock_drift() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1000,
      1500,
      0,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid negative max clock drift
test test_validate_fail_negative_max_clock_drift() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1000,
      1500,
      -1,
      Height { revision_number: 0, revision_height: 8 },
      [],
    )
  client_state.validate(cs)
}

// invalid revision height
test test_validate_fail_invalid_revision_height() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1000,
      1500,
      10,
      Height { revision_number: 0, revision_height: 0 },
      [],
    )
  client_state.validate(cs)
}

// trusting period not less than unbonding period
test test_validate_fail_trusting_period_not_less_than_unbonding_period() fail {
  let cs =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1501,
      1500,
      10,
      Height { revision_number: 0, revision_height: 0 },
      [],
    )
  client_state.validate(cs)
}

// Unit tests for get_latest_height 
test test_get_timestamp_at_height() {
  let mock_root = merkle.new_merkle_root("mock_root")
  let mock_timestamp = 1000
  let mock_height = Height { revision_number: 0, revision_height: 8 }
  let mock_client_state =
    client_state.new_client_state(
      "sidechain-0",
      rational.from_int(1),
      1000,
      1500,
      10,
      mock_height,
      [],
    )
  let mock_consensus_state =
    ConsensusState {
      timestamp: mock_timestamp,
      next_validators_hash: "",
      root: mock_root,
    }
  client_state.get_timestamp_at_height(
    mock_client_state,
    mock_consensus_state,
    mock_height,
  ) == mock_timestamp
}

test test_get_latest_height() {
  expect Some(trust_level) = rational.new(1, 1)

  let cs =
    ClientState {
      chain_id: "cosmoshub",
      trust_level,
      trusting_period: 1000,
      unbonding_period: 1001,
      max_clock_drift: 1,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: Height { revision_number: 2, revision_height: 2 },
      proof_specs: [],
    }

  client_state.get_latest_height(cs) == Height {
    revision_number: 2,
    revision_height: 2,
  }
}

// Tests the correctness of the new_client_state method.
test new_client_state() {
  // Defining parameters for the client state
  expect Some(trust_level) = rational.new(3, 2)
  let chain_id = "cosmoshub"
  let trusting_period = 1000
  let unbonding_period = 1001
  let max_clock_drift = 1
  let frozen_height = Height { revision_number: 0, revision_height: 0 }
  let latest_height = Height { revision_number: 0, revision_height: 0 }
  let proof_specs =
    []
  // Creating the client state using the defined parameters
  let client_state =
    ClientState {
      chain_id,
      trust_level,
      trusting_period,
      unbonding_period,
      max_clock_drift,
      frozen_height,
      latest_height,
      proof_specs,
    }
  // Asserting that creating a new client state with the same parameters results in the same client state
  client_state.new_client_state(
    chain_id,
    trust_level,
    trusting_period,
    unbonding_period,
    max_clock_drift,
    latest_height,
    proof_specs,
  ) == client_state
}

// Tests the correctness of the new_client_state method.
test status() {
  expect Some(trust_level) = rational.new(3, 2)
  let sample_root =
    MerkleRoot {
      hash: #"92dad9443e4dd6d70a7f11872101ebff87e21798e4fbb26fa4bf590eb440e71b",
    }
  let next_validators_hash =
    #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"
  let chain_id = "cosmoshub"
  let trusting_period = 1000
  let unbonding_period = 1001
  let max_clock_drift = 1
  let frozen_height_zero = Height { revision_number: 0, revision_height: 0 }
  let frozen_height = Height { revision_number: 1, revision_height: 1 }
  let latest_height = Height { revision_number: 0, revision_height: 0 }
  let proof_specs =
    []
  let test_cases: List<
    (ClientState, Time, Dict<Height, ConsensusState>, Status),
  > =
    [
      // Frozen - Frozen height of the client state is non-zero
      (
        ClientState {
          chain_id,
          trust_level,
          trusting_period,
          unbonding_period,
          max_clock_drift,
          frozen_height,
          latest_height,
          proof_specs,
        },
        10000000,
        dict.new()
          |> dict.insert(
               latest_height,
               ConsensusState {
                 timestamp: 0,
                 next_validators_hash,
                 root: sample_root,
               },
               height.compare,
             ),
        Frozen,
      ),
      // Expired when consensus state is not found
      (
        ClientState {
          chain_id,
          trust_level,
          trusting_period,
          unbonding_period,
          max_clock_drift,
          frozen_height: frozen_height_zero,
          latest_height,
          proof_specs,
        },
        10000000,
        dict.new(),
        Expired,
      ),
      // Expired when consensus state time + trusting period <= now
      (
        ClientState {
          chain_id,
          trust_level,
          trusting_period,
          unbonding_period,
          max_clock_drift,
          frozen_height: frozen_height_zero,
          latest_height,
          proof_specs,
        },
        10000000,
        dict.new()
          |> dict.insert(
               latest_height,
               ConsensusState {
                 timestamp: 9999000,
                 next_validators_hash,
                 root: sample_root,
               },
               height.compare,
             ),
        Expired,
      ),
      //Active consensus state time + trusting period > now
      (
        ClientState {
          chain_id,
          trust_level,
          trusting_period,
          unbonding_period,
          max_clock_drift,
          frozen_height: frozen_height_zero,
          latest_height,
          proof_specs,
        },
        10000000,
        dict.new()
          |> dict.insert(
               latest_height,
               ConsensusState {
                 timestamp: 10000000,
                 next_validators_hash,
                 root: sample_root,
               },
               height.compare,
             ),
        Active,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           client_state.status(case.1st, case.2nd, case.3rd) == case.4th
         },
       )
}
