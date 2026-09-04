use aiken/collection/list
use aiken/collection/pairs
use aiken/math
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_consensus_state_size,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/types/params

pub type ClientDatum {
  state: ClientDatumState,
  token: AuthToken,
}

pub type ClientDatumState {
  client_state: ClientState,
  consensus_states: Pairs<Height, ConsensusState>,
  processed_times: Pairs<Height, Int>,
  processed_heights: Pairs<Height, Int>,
}

pub fn is_initialized_valid(datum: ClientDatum, auth_token: AuthToken) -> Bool {
  let ClientDatum { state, token } = datum
  let ClientDatumState {
    client_state,
    consensus_states,
    processed_times,
    processed_heights,
  } = state

  // validate client state
  expect client_state_mod.validate(client_state)

  // validate consensus states
  let latest_height = client_state_mod.get_latest_height(client_state)

  when consensus_states is {
    [height_consensus_state] -> and {
        // TODO: add consensus_state.validate_basic()
        height_consensus_state.1st == latest_height,
        pairs.has_key(processed_times, latest_height),
        pairs.has_key(processed_heights, latest_height),
        token == auth_token,
      }
    _ -> False
  }
}

pub fn processed_height_from_time(processed_time: Int) -> Int {
  processed_time / params.max_expected_time_per_block
}

pub fn update_state(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  header: Header,
  tx_valid_from: Int,
) -> Bool {
  let header_height = header_mod.get_height(header)

  let input_datum_cons_state = input_datum.state.consensus_states

  expect (!pairs.has_key(input_datum_cons_state, header_height))?

  let input_height =
    input_datum.state.client_state |> client_state_mod.get_latest_height()
  // Ordinary updates must be submitted in increasing height order. This keeps
  // the consensus state named by latest_height at the head of every bounded
  // history list, so truncation cannot evict it while leaving latest_height
  // unchanged.
  let advances_latest_height =
    height.compare(header_height, input_height) == Greater
  let expected_client_state =
    ClientState {
      ..input_datum.state.client_state,
      latest_height: header_height,
    }

  let expected_cons_state =
    list.filter(
      input_datum_cons_state,
      fn(item) {
        !client_state_mod.is_expired(
          input_datum.state.client_state,
          item.2nd.timestamp,
          tx_valid_from * 1_000_000,
        )
      },
    )
  let expected_cons_state_keys = pairs.keys(expected_cons_state)

  let expected_processed_times =
    list.filter(
      input_datum.state.processed_times,
      fn(item) { list.has(expected_cons_state_keys, item.1st) },
    )

  let expected_processed_heights =
    list.filter(
      input_datum.state.processed_heights,
      fn(item) { list.has(expected_cons_state_keys, item.1st) },
    )

  let cs_len = list.length(expected_cons_state)
  let processed_time = tx_valid_from * 1_000_000
  let processed_height = processed_height_from_time(processed_time)

  let expected_cons_state =
    [
      Pair(header_height, header_mod.consensus_state(header)),
      ..expected_cons_state
    ]
      |> list.slice(from: 0, to: math.min(max_consensus_state_size - 1, cs_len))
  let expected_processed_times =
    [Pair(header_height, processed_time), ..expected_processed_times]
      |> list.slice(from: 0, to: math.min(max_consensus_state_size - 1, cs_len))
  let expected_processed_heights =
    [Pair(header_height, processed_height), ..expected_processed_heights]
      |> list.slice(from: 0, to: math.min(max_consensus_state_size - 1, cs_len))

  let expected_updated_output =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        client_state: expected_client_state,
        consensus_states: expected_cons_state,
        processed_times: expected_processed_times,
        processed_heights: expected_processed_heights,
      },
    }

  // The HostState root commits the exact datum encoding, and Gateway builds
  // this output in the same canonical order as the validator.
  and {
    advances_latest_height,
    expected_updated_output == output_datum,
  }
}

pub fn update_state_on_misbehaviour(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
) -> Bool {
  // frozen_height is same for all misbehaviour
  let frozen_height = Height { revision_number: 0, revision_height: 1 }

  let expected_datum =
    ClientDatum {
      ..input_datum,
      state: ClientDatumState {
        ..input_datum.state,
        client_state: ClientState {
          ..input_datum.state.client_state,
          frozen_height,
        },
      },
    }

  expected_datum == output_datum
}

/// Immutable Tendermint parameters must remain unchanged when an inactive
/// client adopts a trusted checkpoint from a substitute client.
pub fn recovery_parameters_match(
  subject: ClientState,
  substitute: ClientState,
) -> Bool {
  and {
    subject.chain_id == substitute.chain_id,
    subject.trust_level == substitute.trust_level,
    subject.trusting_period == substitute.trusting_period,
    subject.unbonding_period == substitute.unbonding_period,
    subject.max_clock_drift == substitute.max_clock_drift,
    subject.proof_specs == substitute.proof_specs,
  }
}

fn recovered_histories_match(
  input_consensus_states: Pairs<Height, ConsensusState>,
  input_processed_times: Pairs<Height, Int>,
  input_processed_heights: Pairs<Height, Int>,
  output_consensus_states: Pairs<Height, ConsensusState>,
  output_processed_times: Pairs<Height, Int>,
  output_processed_heights: Pairs<Height, Int>,
  remaining: Int,
) -> Bool {
  when input_consensus_states is {
    [] -> and {
        input_processed_times == [],
        input_processed_heights == [],
        output_consensus_states == [],
        output_processed_times == [],
        output_processed_heights == [],
      }
    [input_consensus, ..input_consensus_rest] -> {
      expect [input_time, ..input_time_rest] = input_processed_times
      expect [input_height, ..input_height_rest] = input_processed_heights
      expect input_consensus.1st == input_time.1st
      expect input_consensus.1st == input_height.1st

      if remaining <= 0 {
        and {
          input_consensus_rest == [],
          input_time_rest == [],
          input_height_rest == [],
          output_consensus_states == [],
          output_processed_times == [],
          output_processed_heights == [],
        }
      } else {
        expect [output_consensus, ..output_consensus_rest] =
          output_consensus_states
        expect [output_time, ..output_time_rest] = output_processed_times
        expect [output_height, ..output_height_rest] = output_processed_heights

        and {
          input_consensus == output_consensus,
          input_time == output_time,
          input_height == output_height,
          recovered_histories_match(
            input_consensus_rest,
            input_time_rest,
            input_height_rest,
            output_consensus_rest,
            output_time_rest,
            output_height_rest,
            remaining - 1,
          ),
        }
      }
    }
  }
}

/// Replace the subject's trusted tip with the substitute's latest checkpoint.
/// Existing subject history is retained. At the capacity bound only the final
/// entry is evicted, which keeps the HostState deletion proof bounded to one.
pub fn recover_state(
  subject: ClientDatum,
  substitute: ClientDatum,
  output: ClientDatum,
) -> Bool {
  let subject_state = subject.state
  let substitute_state = substitute.state
  let subject_client_state = subject_state.client_state
  let substitute_client_state = substitute_state.client_state
  let substitute_height = substitute_client_state.latest_height

  expect
    recovery_parameters_match(subject_client_state, substitute_client_state)
  expect
    height.compare(substitute_height, subject_client_state.latest_height) == Greater
  expect !pairs.has_key(subject_state.consensus_states, substitute_height)

  expect Some(substitute_consensus_state) =
    pairs.get_first(substitute_state.consensus_states, substitute_height)
  expect Some(substitute_processed_time) =
    pairs.get_first(substitute_state.processed_times, substitute_height)
  expect Some(substitute_processed_height) =
    pairs.get_first(substitute_state.processed_heights, substitute_height)

  expect [output_consensus_head, ..output_consensus_tail] =
    output.state.consensus_states
  expect [output_time_head, ..output_time_tail] = output.state.processed_times
  expect [output_height_head, ..output_height_tail] =
    output.state.processed_heights

  let expected_client_state =
    ClientState {
      ..subject_client_state,
      frozen_height: height.zero_height(),
      latest_height: substitute_height,
    }
  let retained_history_size = max_consensus_state_size - 1

  and {
    output.token == subject.token,
    output.state.client_state == expected_client_state,
    output_consensus_head == Pair(substitute_height, substitute_consensus_state),
    output_time_head == Pair(substitute_height, substitute_processed_time),
    output_height_head == Pair(substitute_height, substitute_processed_height),
    recovered_histories_match(
      subject_state.consensus_states,
      subject_state.processed_times,
      subject_state.processed_heights,
      output_consensus_tail,
      output_time_tail,
      output_height_tail,
      retained_history_size,
    ),
  }
}
