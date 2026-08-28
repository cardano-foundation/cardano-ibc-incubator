use aiken/collection/list
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Spend, Transaction,
  placeholder,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{UpdateClientProof}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/proof_update/production_fixture as test_fixture
use ibc/client/ics_007_tendermint_client/proof_update/state.{
  Misbehaviour, ProofUpdateRedeemer, Update,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

const client_input_ref =
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: 0,
  }

const other_input_ref =
  OutputReference {
    transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
    output_index: 0,
  }

fn fixture_input_datum() -> ClientDatum {
  let output = test_fixture.output()
  ClientDatum {
    state: ClientDatumState {
      client_state: output.client_state,
      consensus_states: [
        Pair(output.trusted_height, output.trusted_consensus_state),
      ],
      processed_times: [Pair(output.trusted_height, 0)],
      processed_heights: [Pair(output.trusted_height, 0)],
    },
    token: AuthToken { policy_id: #"01", name: #"02" },
  }
}

fn fixture_redeemer() -> ProofUpdateRedeemer {
  let output = test_fixture.output()
  Update {
    client_input_ref,
    trusted_height: output.trusted_height,
    new_height: output.new_height,
    new_consensus_state: output.new_consensus_state,
    proof_time: output.time,
    proof: test_fixture.proof_bytes,
  }
}

fn fixture_tx_valid_from() -> Int {
  ( test_fixture.output().time / 1_000_000 + 1_000 ) * 1_000_000
}

fn fixture_tx_valid_to() -> Int {
  ( test_fixture.output().time / 1_000_000 + 121_000 ) * 1_000_000
}

fn fixture_output_datum() -> ClientDatum {
  let input = fixture_input_datum()
  let output = test_fixture.output()
  let processed_time = fixture_tx_valid_from()
  ClientDatum {
    ..input,
    state: ClientDatumState {
      client_state: ClientState {
        ..output.client_state,
        latest_height: output.new_height,
      },
      consensus_states: [
        Pair(output.new_height, output.new_consensus_state),
        Pair(output.trusted_height, output.trusted_consensus_state),
      ],
      processed_times: [
        Pair(output.new_height, processed_time),
        Pair(output.trusted_height, 0),
      ],
      processed_heights: [
        Pair(
          output.new_height,
          client_datum.processed_height_from_time(processed_time),
        ),
        Pair(output.trusted_height, 0),
      ],
    },
  }
}

fn older_fixture_consensus_states(
  revision_height: Int,
  timestamp: Int,
  count: Int,
) -> Pairs<Height, ConsensusState> {
  if count == 0 {
    []
  } else {
    let trusted = test_fixture.output().trusted_consensus_state
    [
      Pair(
        Height {
          revision_number: test_fixture.output().trusted_height.revision_number,
          revision_height,
        },
        ConsensusState { ..trusted, timestamp },
      ),
      ..older_fixture_consensus_states(
        revision_height - 1,
        timestamp - 1,
        count - 1,
      )
    ]
  }
}

fn fixture_history_input_datum(count: Int) -> ClientDatum {
  expect count > 0
  expect count <= 300
  let fixture = test_fixture.output()
  let consensus_states =
    [
      Pair(fixture.trusted_height, fixture.trusted_consensus_state),
      ..older_fixture_consensus_states(
        fixture.trusted_height.revision_height - 1,
        fixture.trusted_consensus_state.timestamp - 1,
        count - 1,
      )
    ]
  ClientDatum {
    state: ClientDatumState {
      client_state: fixture.client_state,
      consensus_states,
      processed_times: list.map(
        consensus_states,
        fn(pair) { Pair(pair.1st, 0) },
      ),
      processed_heights: list.map(
        consensus_states,
        fn(pair) { Pair(pair.1st, 0) },
      ),
    },
    token: AuthToken { policy_id: #"01", name: #"02" },
  }
}

fn fixture_history_output_datum(input: ClientDatum) -> ClientDatum {
  let fixture = test_fixture.output()
  let input_size = list.length(input.state.consensus_states)
  let retained_size =
    if input_size == state.max_proof_consensus_state_size {
      state.max_proof_consensus_state_size - 1
    } else if input_size == 300 {
      299
    } else {
      input_size
    }
  let retained_consensus_states =
    list.take(input.state.consensus_states, retained_size)
  let retained_processed_times =
    list.take(input.state.processed_times, retained_size)
  let retained_processed_heights =
    list.take(input.state.processed_heights, retained_size)
  let processed_time = fixture_tx_valid_from()
  ClientDatum {
    ..input,
    state: ClientDatumState {
      client_state: ClientState {
        ..fixture.client_state,
        latest_height: fixture.new_height,
      },
      consensus_states: [
        Pair(fixture.new_height, fixture.new_consensus_state),
        ..retained_consensus_states
      ],
      processed_times: [
        Pair(fixture.new_height, processed_time),
        ..retained_processed_times
      ],
      processed_heights: [
        Pair(
          fixture.new_height,
          client_datum.processed_height_from_time(processed_time),
        ),
        ..retained_processed_heights
      ],
    },
  }
}

fn fixture_full_history_input_datum() -> ClientDatum {
  fixture_history_input_datum(300)
}

fn fixture_full_history_output_datum(input: ClientDatum) -> ClientDatum {
  fixture_history_output_datum(input)
}

fn fixture_client_output(datum: ClientDatum) -> Output {
  let token = datum.token
  Output {
    address: from_script(
      #"11111111111111111111111111111111111111111111111111111111",
    ),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn fixture_transaction() -> Transaction {
  let proof_update: Redeemer = UpdateClientProof
  Transaction {
    ..placeholder,
    inputs: [
      Input(client_input_ref, fixture_client_output(fixture_input_datum())),
    ],
    outputs: [fixture_client_output(fixture_output_datum())],
    validity_range: interval.between(
      fixture_tx_valid_from() / 1_000_000,
      fixture_tx_valid_to() / 1_000_000,
    ),
    redeemers: [Pair(Spend(client_input_ref), proof_update)],
  }
}

fn fixture_history_transaction(count: Int) -> Transaction {
  let proof_update: Redeemer = UpdateClientProof
  let input_datum = fixture_history_input_datum(count)
  Transaction {
    ..placeholder,
    inputs: [Input(client_input_ref, fixture_client_output(input_datum))],
    outputs: [fixture_client_output(fixture_history_output_datum(input_datum))],
    validity_range: interval.between(
      fixture_tx_valid_from() / 1_000_000,
      fixture_tx_valid_to() / 1_000_000,
    ),
    redeemers: [Pair(Spend(client_input_ref), proof_update)],
  }
}

fn proof_limit_height(offset: Int) -> Height {
  let trusted_height = test_fixture.output().trusted_height
  Height {
    ..trusted_height,
    revision_height: trusted_height.revision_height - offset,
  }
}

fn proof_limit_consensus_state(offset: Int) -> ConsensusState {
  let trusted = test_fixture.output().trusted_consensus_state
  ConsensusState { ..trusted, timestamp: trusted.timestamp - offset }
}

fn proof_limit_input_datum() -> ClientDatum {
  let fixture = test_fixture.output()
  ClientDatum {
    state: ClientDatumState {
      client_state: fixture.client_state,
      consensus_states: [
        Pair(proof_limit_height(0), proof_limit_consensus_state(0)),
        Pair(proof_limit_height(1), proof_limit_consensus_state(1)),
        Pair(proof_limit_height(2), proof_limit_consensus_state(2)),
        Pair(proof_limit_height(3), proof_limit_consensus_state(3)),
        Pair(proof_limit_height(4), proof_limit_consensus_state(4)),
        Pair(proof_limit_height(5), proof_limit_consensus_state(5)),
        Pair(proof_limit_height(6), proof_limit_consensus_state(6)),
        Pair(proof_limit_height(7), proof_limit_consensus_state(7)),
        Pair(proof_limit_height(8), proof_limit_consensus_state(8)),
        Pair(proof_limit_height(9), proof_limit_consensus_state(9)),
      ],
      processed_times: [
        Pair(proof_limit_height(0), 0),
        Pair(proof_limit_height(1), 0),
        Pair(proof_limit_height(2), 0),
        Pair(proof_limit_height(3), 0),
        Pair(proof_limit_height(4), 0),
        Pair(proof_limit_height(5), 0),
        Pair(proof_limit_height(6), 0),
        Pair(proof_limit_height(7), 0),
        Pair(proof_limit_height(8), 0),
        Pair(proof_limit_height(9), 0),
      ],
      processed_heights: [
        Pair(proof_limit_height(0), 0),
        Pair(proof_limit_height(1), 0),
        Pair(proof_limit_height(2), 0),
        Pair(proof_limit_height(3), 0),
        Pair(proof_limit_height(4), 0),
        Pair(proof_limit_height(5), 0),
        Pair(proof_limit_height(6), 0),
        Pair(proof_limit_height(7), 0),
        Pair(proof_limit_height(8), 0),
        Pair(proof_limit_height(9), 0),
      ],
    },
    token: AuthToken { policy_id: #"01", name: #"02" },
  }
}

fn proof_limit_output_datum() -> ClientDatum {
  let fixture = test_fixture.output()
  let processed_time = fixture_tx_valid_from()
  ClientDatum {
    state: ClientDatumState {
      client_state: ClientState {
        ..fixture.client_state,
        latest_height: fixture.new_height,
      },
      consensus_states: [
        Pair(fixture.new_height, fixture.new_consensus_state),
        Pair(proof_limit_height(0), proof_limit_consensus_state(0)),
        Pair(proof_limit_height(1), proof_limit_consensus_state(1)),
        Pair(proof_limit_height(2), proof_limit_consensus_state(2)),
        Pair(proof_limit_height(3), proof_limit_consensus_state(3)),
        Pair(proof_limit_height(4), proof_limit_consensus_state(4)),
        Pair(proof_limit_height(5), proof_limit_consensus_state(5)),
        Pair(proof_limit_height(6), proof_limit_consensus_state(6)),
        Pair(proof_limit_height(7), proof_limit_consensus_state(7)),
        Pair(proof_limit_height(8), proof_limit_consensus_state(8)),
      ],
      processed_times: [
        Pair(fixture.new_height, processed_time),
        Pair(proof_limit_height(0), 0),
        Pair(proof_limit_height(1), 0),
        Pair(proof_limit_height(2), 0),
        Pair(proof_limit_height(3), 0),
        Pair(proof_limit_height(4), 0),
        Pair(proof_limit_height(5), 0),
        Pair(proof_limit_height(6), 0),
        Pair(proof_limit_height(7), 0),
        Pair(proof_limit_height(8), 0),
      ],
      processed_heights: [
        Pair(
          fixture.new_height,
          client_datum.processed_height_from_time(processed_time),
        ),
        Pair(proof_limit_height(0), 0),
        Pair(proof_limit_height(1), 0),
        Pair(proof_limit_height(2), 0),
        Pair(proof_limit_height(3), 0),
        Pair(proof_limit_height(4), 0),
        Pair(proof_limit_height(5), 0),
        Pair(proof_limit_height(6), 0),
        Pair(proof_limit_height(7), 0),
        Pair(proof_limit_height(8), 0),
      ],
    },
    token: AuthToken { policy_id: #"01", name: #"02" },
  }
}

fn proof_limit_transaction() -> Transaction {
  let proof_update: Redeemer = UpdateClientProof
  Transaction {
    ..placeholder,
    inputs: [
      Input(client_input_ref, fixture_client_output(proof_limit_input_datum())),
    ],
    outputs: [fixture_client_output(proof_limit_output_datum())],
    validity_range: interval.between(
      fixture_tx_valid_from() / 1_000_000,
      fixture_tx_valid_to() / 1_000_000,
    ),
    redeemers: [Pair(Spend(client_input_ref), proof_update)],
  }
}

fn fixture_history_setup_is_well_formed(count: Int) -> Bool {
  let Transaction { inputs, outputs, .. } = fixture_history_transaction(count)
  expect [Input { output: input_output, .. }] = inputs
  expect InlineDatum(input_datum) = input_output.datum
  expect [output] = outputs
  expect InlineDatum(output_datum) = output.datum
  expect input: ClientDatum = input_datum
  expect updated: ClientDatum = output_datum
  let expected_output_size =
    if count == state.max_proof_consensus_state_size {
      count
    } else {
      count + 1
    }
  list.length(input.state.consensus_states) == count && list.length(
    updated.state.consensus_states,
  ) == expected_output_size
}

test full_transition_accepts_proof_generated_before_cardano_validity_window() {
  state.verify_transition(
    fixture_input_datum(),
    fixture_output_datum(),
    fixture_redeemer(),
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
    test_fixture.program_vkey,
    test_fixture.verification_key(),
  )
}

test full_transaction_accepts_exact_proof_update() {
  state.verify_transaction(
    fixture_redeemer(),
    fixture_transaction(),
    test_fixture.program_vkey,
    #"00",
    test_fixture.verification_key(),
  )
}

test full_history_transition_rejects_proof_update_above_limit() {
  let input = fixture_full_history_input_datum()
  !state.verify_transition(
    input,
    fixture_full_history_output_datum(input),
    fixture_redeemer(),
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
    test_fixture.program_vkey,
    test_fixture.verification_key(),
  )
}

test proof_transaction_at_10_consensus_state_limit_succeeds() {
  state.verify_transaction(
    fixture_redeemer(),
    proof_limit_transaction(),
    test_fixture.program_vkey,
    #"00",
    test_fixture.verification_key(),
  )
}

test proof_transaction_above_10_consensus_state_limit_rejects() {
  !state.verify_transaction(
    fixture_redeemer(),
    fixture_history_transaction(11),
    test_fixture.program_vkey,
    #"00",
    test_fixture.verification_key(),
  )
}

test proof_transaction_with_25_consensus_states_rejects() {
  !state.verify_transaction(
    fixture_redeemer(),
    fixture_history_transaction(25),
    test_fixture.program_vkey,
    #"00",
    test_fixture.verification_key(),
  )
}

test proof_transaction_with_50_consensus_states_rejects() {
  !state.verify_transaction(
    fixture_redeemer(),
    fixture_history_transaction(50),
    test_fixture.program_vkey,
    #"00",
    test_fixture.verification_key(),
  )
}

test proof_pre_capacity_transition_rejects_dropped_history_tail() {
  let input = fixture_history_input_datum(9)
  let output = fixture_history_output_datum(input)
  let changed_output =
    ClientDatum {
      ..output,
      state: ClientDatumState {
        ..output.state,
        consensus_states: list.take(output.state.consensus_states, 9),
      },
    }
  !state.verify_cardano_transition(
    input,
    changed_output,
    fixture_redeemer(),
    test_fixture.output().trusted_consensus_state,
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
  )
}

test proof_transaction_fixture_setup_10() {
  let input = proof_limit_input_datum()
  let output = proof_limit_output_datum()
  list.length(input.state.consensus_states) == 10 && list.length(
    output.state.consensus_states,
  ) == 10
}

test proof_transaction_fixture_setup_25() {
  fixture_history_setup_is_well_formed(25)
}

test proof_transaction_fixture_setup_50() {
  fixture_history_setup_is_well_formed(50)
}

test full_history_fixture_has_expected_capacity() {
  let input = fixture_full_history_input_datum()
  let output = fixture_full_history_output_datum(input)
  list.length(input.state.consensus_states) == 300 && list.length(
    output.state.consensus_states,
  ) == 300
}

test full_history_cardano_transition_rejects_update_above_proof_limit() {
  let input = fixture_full_history_input_datum()
  !state.verify_cardano_transition(
    input,
    fixture_full_history_output_datum(input),
    fixture_redeemer(),
    test_fixture.output().trusted_consensus_state,
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
  )
}

test single_header_misbehaviour_freeze_rejects_history_above_proof_limit() {
  let input = fixture_history_input_datum(11)
  let fixture = test_fixture.output()
  let conflicting_consensus_state =
    ConsensusState {
      ..fixture.trusted_consensus_state,
      root: MerkleRoot {
        hash: #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    }
  let redeemer =
    Update {
      client_input_ref,
      trusted_height: fixture.trusted_height,
      new_height: fixture.trusted_height,
      new_consensus_state: conflicting_consensus_state,
      proof_time: fixture.time,
      proof: #"",
    }

  !state.verify_cardano_transition(
    input,
    frozen_output(input),
    redeemer,
    fixture.trusted_consensus_state,
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
  )
}

test two_header_misbehaviour_freeze_rejects_history_above_proof_limit() {
  let input = fixture_history_input_datum(11)
  let fixture = test_fixture.output()

  !state.verify_misbehaviour_cardano_transition(
    input,
    frozen_output(input),
    fixture.trusted_height,
    fixture.trusted_height,
    fixture.trusted_consensus_state,
    fixture.trusted_consensus_state,
    fixture.time,
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
  )
}

test full_history_misbehaviour_scan_finds_no_violation() {
  let input = fixture_full_history_input_datum()
  !state.check_for_misbehaviour(
    input.state.consensus_states,
    test_fixture.output().new_height,
    test_fixture.output().new_consensus_state,
  )
}

test full_transition_binds_exact_proof_time() {
  let redeemer = fixture_redeemer()
  expect Update {
    client_input_ref,
    trusted_height,
    new_height,
    new_consensus_state,
    proof_time,
    proof,
  } = redeemer
  !state.verify_transition(
    fixture_input_datum(),
    fixture_output_datum(),
    Update {
      client_input_ref,
      trusted_height,
      new_height,
      new_consensus_state,
      proof_time: proof_time + 1,
      proof,
    },
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
    test_fixture.program_vkey,
    test_fixture.verification_key(),
  )
}

test proof_transition_rejects_non_eureka_clock_drift() {
  let input = fixture_input_datum()
  let output = fixture_output_datum()
  let changed_input =
    ClientDatum {
      ..input,
      state: ClientDatumState {
        ..input.state,
        client_state: ClientState {
          ..input.state.client_state,
          max_clock_drift: 15_000_000_001,
        },
      },
    }
  let changed_output =
    ClientDatum {
      ..output,
      state: ClientDatumState {
        ..output.state,
        client_state: ClientState {
          ..output.state.client_state,
          max_clock_drift: 15_000_000_001,
        },
      },
    }
  !state.verify_transition(
    changed_input,
    changed_output,
    fixture_redeemer(),
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
    test_fixture.program_vkey,
    test_fixture.verification_key(),
  )
}

test normal_transition_rejects_any_output_datum_change() {
  let output_datum = fixture_output_datum()
  let output_state = output_datum.state
  let changed_output =
    ClientDatum {
      ..output_datum,
      state: ClientDatumState {
        ..output_state,
        processed_times: [
          Pair(test_fixture.output().new_height, fixture_tx_valid_from() + 1),
          Pair(test_fixture.output().trusted_height, 0),
        ],
      },
    }

  !state.verify_cardano_transition(
    fixture_input_datum(),
    changed_output,
    fixture_redeemer(),
    test_fixture.output().trusted_consensus_state,
    fixture_tx_valid_from(),
    fixture_tx_valid_to(),
  )
}

test proof_withdrawal_binds_exactly_one_client_spend() {
  let proof_update: Redeemer = UpdateClientProof
  let other: Redeemer = Void
  and {
    state.binds_unique_client_input(
      [
        Pair(Spend(client_input_ref), proof_update),
        Pair(Spend(other_input_ref), other),
      ],
      client_input_ref,
    ),
    !state.binds_unique_client_input(
      [Pair(Spend(other_input_ref), proof_update)],
      client_input_ref,
    ),
    !state.binds_unique_client_input([], client_input_ref),
  }
}

test proof_withdrawal_rejects_two_update_client_proof_spends() {
  let proof_update: Redeemer = UpdateClientProof
  !state.binds_unique_client_input(
    [
      Pair(Spend(client_input_ref), proof_update),
      Pair(Spend(other_input_ref), proof_update),
    ],
    client_input_ref,
  )
}

fn production_misbehaviour_input_datum() -> ClientDatum {
  let output = test_fixture.misbehaviour_output()
  let latest_consensus_state =
    ConsensusState {
      ..output.trusted_consensus_state_1,
      timestamp: output.trusted_consensus_state_1.timestamp + 1,
    }
  let latest_processed_time =
    output.trusted_consensus_state_1.timestamp + 1_000_000_000
  ClientDatum {
    state: ClientDatumState {
      client_state: output.client_state,
      consensus_states: [
        Pair(output.client_state.latest_height, latest_consensus_state),
        Pair(output.trusted_height_1, output.trusted_consensus_state_1),
      ],
      processed_times: [
        Pair(output.client_state.latest_height, latest_processed_time),
        Pair(output.trusted_height_1, 0),
      ],
      processed_heights: [
        Pair(
          output.client_state.latest_height,
          client_datum.processed_height_from_time(latest_processed_time),
        ),
        Pair(output.trusted_height_1, 0),
      ],
    },
    token: AuthToken { policy_id: #"01", name: #"02" },
  }
}

fn production_misbehaviour_redeemer() -> ProofUpdateRedeemer {
  let output = test_fixture.misbehaviour_output()
  Misbehaviour {
    client_input_ref,
    trusted_height_1: output.trusted_height_1,
    trusted_height_2: output.trusted_height_2,
    proof_time: output.time,
    proof: test_fixture.misbehaviour_proof_bytes,
  }
}

fn production_misbehaviour_tx_valid_from() -> Int {
  test_fixture.misbehaviour_output().time / 1_000_000 * 1_000_000
}

fn production_misbehaviour_tx_valid_to() -> Int {
  ( test_fixture.misbehaviour_output().time / 1_000_000 + 121_000 ) * 1_000_000
}

fn production_misbehaviour_transaction() -> Transaction {
  let input = production_misbehaviour_input_datum()
  let proof_update: Redeemer = UpdateClientProof
  Transaction {
    ..placeholder,
    inputs: [Input(client_input_ref, fixture_client_output(input))],
    outputs: [fixture_client_output(frozen_output(input))],
    validity_range: interval.between(
      production_misbehaviour_tx_valid_from() / 1_000_000,
      production_misbehaviour_tx_valid_to() / 1_000_000,
    ),
    redeemers: [Pair(Spend(client_input_ref), proof_update)],
  }
}

test full_transaction_accepts_exact_released_misbehaviour_proof() {
  state.verify_transaction(
    production_misbehaviour_redeemer(),
    production_misbehaviour_transaction(),
    test_fixture.update_program_vkey,
    test_fixture.misbehaviour_program_vkey,
    test_fixture.verification_key(),
  )
}

test two_header_misbehaviour_rejects_wrong_client_input_binding() fail {
  let proof_output = test_fixture.misbehaviour_output()
  state.verify_transaction(
    Misbehaviour {
      client_input_ref: other_input_ref,
      trusted_height_1: proof_output.trusted_height_1,
      trusted_height_2: proof_output.trusted_height_2,
      proof_time: proof_output.time,
      proof: test_fixture.misbehaviour_proof_bytes,
    },
    production_misbehaviour_transaction(),
    test_fixture.update_program_vkey,
    test_fixture.misbehaviour_program_vkey,
    test_fixture.verification_key(),
  )
}

test two_header_cardano_transition_produces_exact_frozen_successor() {
  let proof_output = test_fixture.misbehaviour_output()
  let input = production_misbehaviour_input_datum()
  let frozen = frozen_output(input)
  and {
    state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      proof_output.trusted_height_1,
      proof_output.trusted_height_2,
      proof_output.trusted_consensus_state_1,
      proof_output.trusted_consensus_state_2,
      proof_output.time,
      production_misbehaviour_tx_valid_from(),
      production_misbehaviour_tx_valid_to(),
    ),
    !state.verify_misbehaviour_cardano_transition(
      input,
      input,
      proof_output.trusted_height_1,
      proof_output.trusted_height_2,
      proof_output.trusted_consensus_state_1,
      proof_output.trusted_consensus_state_2,
      proof_output.time,
      production_misbehaviour_tx_valid_from(),
      production_misbehaviour_tx_valid_to(),
    ),
  }
}

test two_header_cardano_transition_rejects_future_proof_or_invalid_range() {
  let proof_output = test_fixture.misbehaviour_output()
  let input = production_misbehaviour_input_datum()
  let frozen = frozen_output(input)
  let valid_from = production_misbehaviour_tx_valid_from()
  let valid_to = production_misbehaviour_tx_valid_to()
  and {
    !state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      proof_output.trusted_height_1,
      proof_output.trusted_height_2,
      proof_output.trusted_consensus_state_1,
      proof_output.trusted_consensus_state_2,
      valid_to + 1,
      valid_from,
      valid_to,
    ),
    !state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      proof_output.trusted_height_1,
      proof_output.trusted_height_2,
      proof_output.trusted_consensus_state_1,
      proof_output.trusted_consensus_state_2,
      proof_output.time,
      valid_to,
      valid_from,
    ),
  }
}

test two_header_cardano_transition_checks_each_exact_trusted_state_expiry() {
  let older_height = height(10)
  let latest_height = height(11)
  let older = consensus_state(1_000, #"01")
  let latest = consensus_state(10_000, #"02")
  let input =
    small_client_datum(
      latest_height,
      [Pair(latest_height, latest), Pair(older_height, older)],
      5_000,
    )
  let frozen = frozen_output(input)
  and {
    !state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      older_height,
      latest_height,
      older,
      latest,
      10_000,
      10_000,
      10_001,
    ),
    !state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      latest_height,
      older_height,
      latest,
      older,
      10_000,
      10_000,
      10_001,
    ),
  }
}

test two_header_cardano_transition_checks_both_revisions() {
  let proof_output = test_fixture.misbehaviour_output()
  let input = production_misbehaviour_input_datum()
  let frozen = frozen_output(input)
  let wrong_revision = Height { revision_number: 2, revision_height: 11 }
  and {
    !state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      wrong_revision,
      proof_output.trusted_height_2,
      proof_output.trusted_consensus_state_1,
      proof_output.trusted_consensus_state_2,
      proof_output.time,
      production_misbehaviour_tx_valid_from(),
      production_misbehaviour_tx_valid_to(),
    ),
    !state.verify_misbehaviour_cardano_transition(
      input,
      frozen,
      proof_output.trusted_height_1,
      wrong_revision,
      proof_output.trusted_consensus_state_1,
      proof_output.trusted_consensus_state_2,
      proof_output.time,
      production_misbehaviour_tx_valid_from(),
      production_misbehaviour_tx_valid_to(),
    ),
  }
}

fn height(revision_height: Int) -> Height {
  Height { revision_number: 1, revision_height }
}

fn consensus_state(timestamp: Int, root: ByteArray) -> ConsensusState {
  ConsensusState {
    timestamp,
    root: MerkleRoot { hash: root },
    next_validators_hash: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }
}

fn small_client_datum(
  latest_height: Height,
  consensus_states: Pairs<Height, ConsensusState>,
  trusting_period: Int,
) -> ClientDatum {
  ClientDatum {
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: #"636861696e2d31",
        trust_level: UncheckedRational { numerator: 1, denominator: 3 },
        trusting_period,
        unbonding_period: 20_000,
        max_clock_drift: 100,
        frozen_height: Height { revision_number: 0, revision_height: 0 },
        latest_height,
        proof_specs: [],
      },
      consensus_states,
      processed_times: list.map(
        consensus_states,
        fn(pair) { Pair(pair.1st, 0) },
      ),
      processed_heights: list.map(
        consensus_states,
        fn(pair) { Pair(pair.1st, 0) },
      ),
    },
    token: AuthToken { policy_id: #"01", name: #"02" },
  }
}

fn small_redeemer(
  trusted_height: Height,
  new_height: Height,
  new_consensus_state: ConsensusState,
  proof_time: Int,
) -> ProofUpdateRedeemer {
  Update {
    client_input_ref,
    trusted_height,
    new_height,
    new_consensus_state,
    proof_time,
    proof: #"",
  }
}

fn frozen_output(input: ClientDatum) -> ClientDatum {
  ClientDatum {
    ..input,
    state: ClientDatumState {
      ..input.state,
      client_state: ClientState {
        ..input.state.client_state,
        frozen_height: Height { revision_number: 0, revision_height: 1 },
      },
    },
  }
}

test conflicting_stored_consensus_state_produces_exact_frozen_datum() {
  let trusted_height = height(10)
  let new_height = height(11)
  let trusted = consensus_state(1_000, #"01")
  let stored = consensus_state(2_000, #"02")
  let proved = consensus_state(2_000, #"03")
  let input =
    small_client_datum(
      trusted_height,
      [Pair(new_height, stored), Pair(trusted_height, trusted)],
      10_000,
    )
  let redeemer = small_redeemer(trusted_height, new_height, proved, 1_900)

  and {
    state.verify_cardano_transition(
      input,
      frozen_output(input),
      redeemer,
      trusted,
      2_000,
      2_500,
    ),
    !state.verify_cardano_transition(
      input,
      input,
      redeemer,
      trusted,
      2_000,
      2_500,
    ),
  }
}

test timestamp_monotonicity_violations_produce_frozen_datum() {
  let trusted_height = height(9)
  let latest_height = height(10)
  let new_height = height(11)
  let trusted = consensus_state(1_000, #"01")
  let previous = consensus_state(2_050, #"02")
  let proved = consensus_state(2_050, #"03")
  let previous_input =
    small_client_datum(
      latest_height,
      [Pair(latest_height, previous), Pair(trusted_height, trusted)],
      10_000,
    )
  let previous_redeemer =
    small_redeemer(trusted_height, new_height, proved, 1_900)

  let next_height = height(12)
  let latest = consensus_state(1_900, #"04")
  let next = consensus_state(2_050, #"05")
  let next_input =
    small_client_datum(
      latest_height,
      [Pair(next_height, next), Pair(latest_height, latest)],
      10_000,
    )
  let next_redeemer = small_redeemer(latest_height, new_height, proved, 1_900)

  and {
    state.verify_cardano_transition(
      previous_input,
      frozen_output(previous_input),
      previous_redeemer,
      trusted,
      2_000,
      2_500,
    ),
    state.verify_cardano_transition(
      next_input,
      frozen_output(next_input),
      next_redeemer,
      latest,
      2_000,
      2_500,
    ),
  }
}

test actual_transaction_time_rejects_stale_trusted_state() {
  let trusted_height = height(9)
  let latest_height = height(10)
  let new_height = height(11)
  let trusted = consensus_state(1_000, #"01")
  let latest = consensus_state(10_000, #"02")
  let stored = consensus_state(11_500, #"03")
  let proved = consensus_state(11_500, #"04")
  let input =
    small_client_datum(
      latest_height,
      [
        Pair(new_height, stored), Pair(latest_height, latest),
        Pair(trusted_height, trusted),
      ],
      2_000,
    )
  let redeemer = small_redeemer(trusted_height, new_height, proved, 11_000)

  !state.verify_cardano_transition(
    input,
    frozen_output(input),
    redeemer,
    trusted,
    11_500,
    11_900,
  )
}

test actual_transaction_time_rejects_future_proof_or_header() {
  let trusted_height = height(10)
  let new_height = height(11)
  let trusted = consensus_state(1_000, #"01")
  let stored = consensus_state(2_000, #"02")
  let proved = consensus_state(2_000, #"03")
  let input =
    small_client_datum(
      trusted_height,
      [Pair(new_height, stored), Pair(trusted_height, trusted)],
      10_000,
    )
  let output = frozen_output(input)

  and {
    !state.verify_cardano_transition(
      input,
      output,
      small_redeemer(trusted_height, new_height, proved, 2_501),
      trusted,
      2_000,
      2_500,
    ),
    !state.verify_cardano_transition(
      input,
      output,
      small_redeemer(
        trusted_height,
        new_height,
        ConsensusState { ..proved, timestamp: 2_100 },
        1_900,
      ),
      trusted,
      2_000,
      2_500,
    ),
  }
}
