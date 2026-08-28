use aiken/collection/list
use aiken/collection/pairs
use cardano/transaction.{
  OutputReference, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_datum as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{UpdateClientProof}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output.{
  UpdateClientOutput,
}
use ibc/client/ics_007_tendermint_client/proof_update/gnark_wrapper.{
  VerificationKey,
}
use ibc/client/ics_007_tendermint_client/proof_update/misbehaviour_output.{
  MisbehaviourOutput,
}
use ibc/client/ics_007_tendermint_client/proof_update/wrapped_proof
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/utils/validator_utils

pub type ProofUpdateRedeemer {
  Update {
    client_input_ref: OutputReference,
    trusted_height: Height,
    new_height: Height,
    new_consensus_state: ConsensusState,
    proof_time: Int,
    proof: ByteArray,
  }
  Misbehaviour {
    client_input_ref: OutputReference,
    trusted_height_1: Height,
    trusted_height_2: Height,
    proof_time: Int,
    proof: ByteArray,
  }
}

type NeighbouringConsensusState {
  height: Height,
  timestamp: Int,
}

/// Proof updates retain at most ten consensus states so the complete Cardano
/// transaction remains below the public-network execution-unit limits. The
/// direct Tendermint update path retains its existing 300-state bound.
pub const max_proof_consensus_state_size: Int = 10

/// Resolve the exact client input and continuation output named by the proof
/// withdrawal redeemer, then verify the proof and complete client transition.
pub fn verify_transaction(
  redeemer: ProofUpdateRedeemer,
  transaction: Transaction,
  update_program_vkey: ByteArray,
  misbehaviour_program_vkey: ByteArray,
  wrapper_vk: VerificationKey,
) -> Bool {
  let Transaction { inputs, outputs, validity_range, redeemers, .. } =
    transaction

  let client_input_ref = proof_client_input_ref(redeemer)
  expect binds_unique_client_input(redeemers, client_input_ref)

  expect Some(client_input) = transaction.find_input(inputs, client_input_ref)
  expect input_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect Some(client_output) =
    list.find(
      outputs,
      fn(output) {
        output.address == client_input.output.address && auth.contain_auth_token(
          output,
          input_datum.token,
        )
      },
    )
  expect output_datum: ClientDatum =
    validator_utils.get_inline_datum(client_output)

  let tx_valid_from =
    validator_utils.get_tx_valid_from(validity_range) * 1_000_000
  let tx_valid_to = validator_utils.get_tx_valid_to(validity_range) * 1_000_000

  when redeemer is {
    Update { .. } ->
      verify_transition(
        input_datum,
        output_datum,
        redeemer,
        tx_valid_from,
        tx_valid_to,
        update_program_vkey,
        wrapper_vk,
      )
    Misbehaviour { .. } ->
      verify_misbehaviour_transition(
        input_datum,
        output_datum,
        redeemer,
        tx_valid_from,
        tx_valid_to,
        misbehaviour_program_vkey,
        wrapper_vk,
      )
  }
}

fn proof_client_input_ref(redeemer: ProofUpdateRedeemer) -> OutputReference {
  when redeemer is {
    Update { client_input_ref, .. } -> client_input_ref
    Misbehaviour { client_input_ref, .. } -> client_input_ref
  }
}

/// Require the proof withdrawal to authorize exactly one proof-based client
/// spend and bind it to the input named by the proof redeemer. This prevents a
/// single proof withdrawal from authorizing additional client inputs.
pub fn binds_unique_client_input(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  client_input_ref: OutputReference,
) -> Bool {
  binds_unique_client_input_go(redeemers, client_input_ref, False)
}

fn binds_unique_client_input_go(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  client_input_ref: OutputReference,
  found: Bool,
) -> Bool {
  let update_client_proof: Redeemer = UpdateClientProof
  when redeemers is {
    [] -> found
    [Pair(purpose, redeemer), ..rest] ->
      when purpose is {
        Spend(found_input_ref) ->
          if redeemer == update_client_proof {
            if found || found_input_ref != client_input_ref {
              False
            } else {
              binds_unique_client_input_go(rest, client_input_ref, True)
            }
          } else {
            binds_unique_client_input_go(rest, client_input_ref, found)
          }
        _ -> binds_unique_client_input_go(rest, client_input_ref, found)
      }
  }
}

/// Bind a valid Eureka proof to the exact Cardano client transition. Times are
/// nanoseconds; the transaction wrapper above converts Cardano milliseconds.
pub fn verify_transition(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  redeemer: ProofUpdateRedeemer,
  tx_valid_from: Int,
  tx_valid_to: Int,
  program_vkey: ByteArray,
  wrapper_vk: VerificationKey,
) -> Bool {
  expect Update {
    trusted_height,
    new_height,
    new_consensus_state,
    proof_time,
    proof,
    ..
  } = redeemer
  let input_state = input_datum.state
  let client_state = input_state.client_state

  expect Some(trusted_consensus_state) =
    pairs.get_first(input_state.consensus_states, trusted_height)

  and {
    verify_cardano_transition(
      input_datum,
      output_datum,
      redeemer,
      trusted_consensus_state,
      tx_valid_from,
      tx_valid_to,
    ),
    wrapped_proof.verify(
      proof,
      program_vkey,
      UpdateClientOutput {
        client_state,
        trusted_consensus_state,
        new_consensus_state,
        time: proof_time,
        trusted_height,
        new_height,
      },
      wrapper_vk,
    ),
  }
}

/// Apply all Cardano-side transition and current-time checks to values already
/// authenticated by the proof. The trusted state passed here is resolved from
/// `redeemer.trusted_height` by `verify_transition` above.
pub fn verify_cardano_transition(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  redeemer: ProofUpdateRedeemer,
  trusted_consensus_state: ConsensusState,
  tx_valid_from: Int,
  tx_valid_to: Int,
) -> Bool {
  expect Update {
    trusted_height,
    new_height,
    new_consensus_state,
    proof_time,
    ..
  } = redeemer
  let input_state = input_datum.state
  let client_state = input_state.client_state
  let input_latest_height = client_state.latest_height

  let found_misbehaviour =
    check_for_misbehaviour(
      input_state.consensus_states,
      new_height,
      new_consensus_state,
    )

  let valid_state_transition =
    if found_misbehaviour {
      client_datum_mod.update_state_on_misbehaviour(input_datum, output_datum)
    } else {
      update_state_with_proof_consensus(
        input_datum,
        output_datum,
        new_height,
        new_consensus_state,
        tx_valid_from,
      )
    }

  and {
    list.length(input_state.consensus_states) <= max_proof_consensus_state_size,
    tx_valid_from <= tx_valid_to,
    client_state_mod.status(
      client_state,
      tx_valid_to,
      input_state.consensus_states,
    ) == Active,
    !client_state_mod.is_expired(
      client_state,
      trusted_consensus_state.timestamp,
      tx_valid_to,
    ),
    trusted_height.revision_number == input_latest_height.revision_number,
    new_height.revision_number == input_latest_height.revision_number,
    new_consensus_state.timestamp < tx_valid_from + client_state.max_clock_drift,
    // Proof generation can outlive a normal Cardano validity interval. The
    // proof is allowed to predate this transaction, but not to postdate it.
    // Expiry and clock drift are independently rechecked above against the
    // actual transaction bounds.
    proof_time <= tx_valid_to,
    valid_state_transition,
  }
}

/// A proof update below the history bound only prepends one aligned entry.
/// Initialization and every accepted update establish the exact tail, so the
/// proof path can compare those tails directly. The existing pruning logic is
/// retained unchanged at the 300-state boundary.
fn update_state_with_proof_consensus(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  new_height: Height,
  new_consensus_state: ConsensusState,
  processed_time: Int,
) -> Bool {
  let input_history_size = list.length(input_datum.state.consensus_states)
  let input_client_state = input_datum.state.client_state
  let expected_client_state =
    ClientState { ..input_client_state, latest_height: new_height }
  when
    (
      input_datum.state.consensus_states,
      output_datum.state.consensus_states,
      output_datum.state.processed_times,
      output_datum.state.processed_heights,
    )
  is {
    (
      [Pair(input_latest_height, _), ..],
      [Pair(output_height, output_consensus_state), ..output_consensus_rest],
      [Pair(output_time_height, output_time), ..output_times_rest],
      [Pair(output_height_key, output_height_value), ..output_heights_rest],
    ) -> and {
        height_mod.compare(new_height, input_client_state.latest_height) == Greater,
        input_latest_height == input_client_state.latest_height,
        input_datum.token == output_datum.token,
        output_datum.state.client_state == expected_client_state,
        output_height == new_height,
        output_consensus_state == new_consensus_state,
        output_time_height == new_height,
        output_time == processed_time,
        output_height_key == new_height,
        output_height_value == client_datum_mod.processed_height_from_time(
          processed_time,
        ),
        if input_history_size < max_proof_consensus_state_size {
          output_consensus_rest == input_datum.state.consensus_states && output_times_rest == input_datum.state.processed_times && output_heights_rest == input_datum.state.processed_heights
        } else if
        input_history_size == max_proof_consensus_state_size {
          retains_exact_proof_history(
            input_datum.state.consensus_states,
            input_datum.state.processed_times,
            input_datum.state.processed_heights,
            output_consensus_rest,
            output_times_rest,
            output_heights_rest,
            input_client_state,
            processed_time,
            max_proof_consensus_state_size - 1,
            new_height,
          )
        } else {
          False
        },
      }
    _ -> False
  }
}

fn retains_exact_proof_history(
  input_consensus_states: Pairs<Height, ConsensusState>,
  input_processed_times: Pairs<Height, Int>,
  input_processed_heights: Pairs<Height, Int>,
  output_consensus_states: Pairs<Height, ConsensusState>,
  output_processed_times: Pairs<Height, Int>,
  output_processed_heights: Pairs<Height, Int>,
  client_state: ClientState,
  processed_time: Int,
  remaining_capacity: Int,
  previous_height: Height,
) -> Bool {
  when
    (input_consensus_states, input_processed_times, input_processed_heights)
  is {
    ([], [], []) ->
      output_consensus_states == [] && output_processed_times == [] && output_processed_heights == []
    (
      [consensus_pair, ..consensus_rest],
      [time_pair, ..times_rest],
      [height_pair, ..heights_rest],
    ) -> {
      let current_height = consensus_pair.1st
      let is_canonical = and {
          time_pair.1st == current_height,
          height_pair.1st == current_height,
          height_mod.compare(current_height, previous_height) == Less,
        }
      let retain =
        remaining_capacity > 0 && !client_state_mod.is_expired(
          client_state,
          consensus_pair.2nd.timestamp,
          processed_time,
        )

      if !is_canonical {
        False
      } else if retain {
        when
          (
            output_consensus_states,
            output_processed_times,
            output_processed_heights,
          )
        is {
          (
            [output_consensus_pair, ..output_consensus_rest],
            [output_time_pair, ..output_times_rest],
            [output_height_pair, ..output_heights_rest],
          ) -> and {
              output_consensus_pair == consensus_pair,
              output_time_pair == time_pair,
              output_height_pair == height_pair,
              retains_exact_proof_history(
                consensus_rest,
                times_rest,
                heights_rest,
                output_consensus_rest,
                output_times_rest,
                output_heights_rest,
                client_state,
                processed_time,
                remaining_capacity - 1,
                current_height,
              ),
            }
          _ -> False
        }
      } else {
        retains_exact_proof_history(
          consensus_rest,
          times_rest,
          heights_rest,
          output_consensus_states,
          output_processed_times,
          output_processed_heights,
          client_state,
          processed_time,
          remaining_capacity,
          current_height,
        )
      }
    }
    _ -> False
  }
}

/// Bind a proved two-header Eureka misbehaviour statement to two exact stored
/// trusted states and the exact frozen Cardano successor datum.
pub fn verify_misbehaviour_transition(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  redeemer: ProofUpdateRedeemer,
  tx_valid_from: Int,
  tx_valid_to: Int,
  program_vkey: ByteArray,
  wrapper_vk: VerificationKey,
) -> Bool {
  expect Misbehaviour {
    trusted_height_1,
    trusted_height_2,
    proof_time,
    proof,
    ..
  } = redeemer
  let input_state = input_datum.state
  let client_state = input_state.client_state
  expect Some(trusted_consensus_state_1) =
    pairs.get_first(input_state.consensus_states, trusted_height_1)
  expect Some(trusted_consensus_state_2) =
    pairs.get_first(input_state.consensus_states, trusted_height_2)

  and {
    verify_misbehaviour_cardano_transition(
      input_datum,
      output_datum,
      trusted_height_1,
      trusted_height_2,
      trusted_consensus_state_1,
      trusted_consensus_state_2,
      proof_time,
      tx_valid_from,
      tx_valid_to,
    ),
    when
      misbehaviour_output.encode(
        MisbehaviourOutput {
          client_state,
          time: proof_time,
          trusted_height_1,
          trusted_height_2,
          trusted_consensus_state_1,
          trusted_consensus_state_2,
        },
      )
    is {
      Some(public_values) ->
        wrapped_proof.verify_encoded(
          proof,
          program_vkey,
          public_values,
          wrapper_vk,
        )
      None -> False
    },
  }
}

/// Apply Cardano's actual transaction-time safety checks to two trusted states
/// authenticated by a Eureka misbehaviour proof.
pub fn verify_misbehaviour_cardano_transition(
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  trusted_height_1: Height,
  trusted_height_2: Height,
  trusted_consensus_state_1: ConsensusState,
  trusted_consensus_state_2: ConsensusState,
  proof_time: Int,
  tx_valid_from: Int,
  tx_valid_to: Int,
) -> Bool {
  let input_state = input_datum.state
  let client_state = input_state.client_state
  let revision_number = client_state.latest_height.revision_number

  and {
    list.length(input_state.consensus_states) <= max_proof_consensus_state_size,
    tx_valid_from <= tx_valid_to,
    client_state_mod.status(
      client_state,
      tx_valid_to,
      input_state.consensus_states,
    ) == Active,
    !client_state_mod.is_expired(
      client_state,
      trusted_consensus_state_1.timestamp,
      tx_valid_to,
    ),
    !client_state_mod.is_expired(
      client_state,
      trusted_consensus_state_2.timestamp,
      tx_valid_to,
    ),
    trusted_height_1.revision_number == revision_number,
    trusted_height_2.revision_number == revision_number,
    proof_time <= tx_valid_to,
    client_datum_mod.update_state_on_misbehaviour(input_datum, output_datum),
  }
}

/// Match the existing single-header misbehaviour rules using the consensus
/// state authenticated by the proof instead of a full relayed Header value.
pub fn check_for_misbehaviour(
  consensus_states: Pairs<Height, ConsensusState>,
  new_height: Height,
  new_consensus_state: ConsensusState,
) -> Bool {
  check_for_misbehaviour_go(
    consensus_states,
    new_height,
    new_consensus_state,
    None,
    None,
  )
}

fn check_for_misbehaviour_go(
  consensus_states: Pairs<Height, ConsensusState>,
  new_height: Height,
  new_consensus_state: ConsensusState,
  previous: Option<NeighbouringConsensusState>,
  next: Option<NeighbouringConsensusState>,
) -> Bool {
  when consensus_states is {
    [] -> {
      let invalid_previous =
        when previous is {
          Some(state) -> state.timestamp >= new_consensus_state.timestamp
          None -> False
        }

      if invalid_previous {
        True
      } else {
        when next is {
          Some(state) -> state.timestamp <= new_consensus_state.timestamp
          None -> False
        }
      }
    }
    [Pair(height, consensus_state), ..rest] ->
      when height_mod.compare(height, new_height) is {
        Equal -> consensus_state != new_consensus_state
        Less -> {
          let previous =
            when previous is {
              Some(found) ->
                if height_mod.compare(height, found.height) == Greater {
                  Some(
                    NeighbouringConsensusState {
                      height,
                      timestamp: consensus_state.timestamp,
                    },
                  )
                } else {
                  previous
                }
              None ->
                Some(
                  NeighbouringConsensusState {
                    height,
                    timestamp: consensus_state.timestamp,
                  },
                )
            }
          check_for_misbehaviour_go(
            rest,
            new_height,
            new_consensus_state,
            previous,
            next,
          )
        }
        Greater -> {
          let next =
            when next is {
              Some(found) ->
                if height_mod.compare(height, found.height) == Less {
                  Some(
                    NeighbouringConsensusState {
                      height,
                      timestamp: consensus_state.timestamp,
                    },
                  )
                } else {
                  next
                }
              None ->
                Some(
                  NeighbouringConsensusState {
                    height,
                    timestamp: consensus_state.timestamp,
                  },
                )
            }
          check_for_misbehaviour_go(
            rest,
            new_height,
            new_consensus_state,
            previous,
            next,
          )
        }
      }
  }
}
