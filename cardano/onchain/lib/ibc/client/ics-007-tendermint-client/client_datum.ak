use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/types/params
use ibc/core/ics_025_handler_interface/ibc_state_commitment

pub type ClientDatum {
  state: ClientDatumState,
  token: AuthToken,
  history_root: ByteArray,
}

pub type ClientDatumState {
  client_state: ClientState,
  consensus_states: Pairs<Height, ConsensusState>,
  processed_times: Pairs<Height, Int>,
  processed_heights: Pairs<Height, Int>,
}

/// The live client contains only its tip; older immutable checkpoints are
/// authenticated against history_root using transaction-provided witnesses.
pub fn has_singleton_history(datum: ClientDatum) -> Bool {
  when
    (
      datum.state.consensus_states,
      datum.state.processed_times,
      datum.state.processed_heights,
    )
  is {
    (
      [Pair(consensus_height, _)],
      [Pair(time_height, _)],
      [Pair(processed_height, _)],
    ) -> and {
        heights_match(consensus_height, datum.state.client_state.latest_height),
        heights_match(time_height, consensus_height),
        heights_match(processed_height, consensus_height),
      }
    _ -> False
  }
}

pub fn is_initialized_valid(datum: ClientDatum, auth_token: AuthToken) -> Bool {
  and {
    client_state_mod.validate(datum.state.client_state),
    has_singleton_history(datum),
    tokens_match(datum.token, auth_token),
    datum.history_root == ibc_state_commitment.empty_hash,
  }
}

pub fn processed_height_from_time(processed_time: Int) -> Int {
  processed_time / params.max_expected_time_per_block
}

fn tokens_match(left: AuthToken, right: AuthToken) -> Bool {
  left.policy_id == right.policy_id && left.name == right.name
}

fn heights_match(left: Height, right: Height) -> Bool {
  left.revision_number == right.revision_number && left.revision_height == right.revision_height
}

fn same_history(left: ClientDatumState, right: ClientDatumState) -> Bool {
  and {
    left.consensus_states == right.consensus_states,
    left.processed_times == right.processed_times,
    left.processed_heights == right.processed_heights,
  }
}

pub fn update_state(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  header: Header,
  tx_valid_to: Int,
) -> Bool {
  expect has_singleton_history(input_datum)
  if !has_singleton_history(output_datum) {
    False
  } else {
    let header_height = header_mod.get_height(header)
    // Inclusion cannot be later than the upper bound, even if the lower bound
    // is backdated. Start the connection delay from that conservative bound.
    let processed_time = tx_valid_to * 1_000_000
    let input_state = input_datum.state.client_state
    let output_state = output_datum.state.client_state
    expect [Pair(_, output_consensus)] = output_datum.state.consensus_states
    expect [Pair(_, output_time)] = output_datum.state.processed_times
    expect [Pair(_, output_height)] = output_datum.state.processed_heights
    and {
      tokens_match(input_datum.token, output_datum.token),
      recovery_parameters_match(input_state, output_state),
      heights_match(input_state.frozen_height, output_state.frozen_height),
      heights_match(output_state.latest_height, header_height),
      height.compare(header_height, input_state.latest_height) == Greater,
      output_consensus.timestamp == header_mod.get_time(header),
      output_consensus.next_validators_hash == header.signed_header.header.next_validators_hash,
      output_consensus.root.hash == header.signed_header.header.app_hash,
      output_time == processed_time,
      output_height == processed_height_from_time(processed_time),
    }
  }
}

pub fn update_state_on_misbehaviour(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
) -> Bool {
  expect has_singleton_history(input_datum)
  let input_state = input_datum.state.client_state
  let output_state = output_datum.state.client_state
  and {
    tokens_match(input_datum.token, output_datum.token),
    recovery_parameters_match(input_state, output_state),
    heights_match(input_state.latest_height, output_state.latest_height),
    output_state.frozen_height.revision_number == 0,
    output_state.frozen_height.revision_height == 1,
    same_history(input_datum.state, output_datum.state),
    input_datum.history_root == output_datum.history_root,
  }
}

pub fn recovery_parameters_match(
  subject: ClientState,
  substitute: ClientState,
) -> Bool {
  and {
    subject.chain_id == substitute.chain_id,
    subject.trust_level.numerator == substitute.trust_level.numerator,
    subject.trust_level.denominator == substitute.trust_level.denominator,
    subject.trusting_period == substitute.trusting_period,
    subject.unbonding_period == substitute.unbonding_period,
    subject.max_clock_drift == substitute.max_clock_drift,
    subject.proof_specs == substitute.proof_specs,
  }
}

/// Recovery replaces the tip and archives the old subject checkpoint under the
/// subject's identity. Substitute processing metadata is preserved exactly.
pub fn recover_state(
  subject: ClientDatum,
  substitute: ClientDatum,
  output: ClientDatum,
) -> Bool {
  expect has_singleton_history(subject)
  expect has_singleton_history(substitute)
  and {
    recovery_parameters_match(
      subject.state.client_state,
      substitute.state.client_state,
    ),
    height.compare(
      substitute.state.client_state.latest_height,
      subject.state.client_state.latest_height,
    ) == Greater,
    tokens_match(output.token, subject.token),
    recovery_parameters_match(
      subject.state.client_state,
      output.state.client_state,
    ),
    heights_match(
      output.state.client_state.latest_height,
      substitute.state.client_state.latest_height,
    ),
    height.is_zero(output.state.client_state.frozen_height),
    same_history(output.state, substitute.state),
  }
}
