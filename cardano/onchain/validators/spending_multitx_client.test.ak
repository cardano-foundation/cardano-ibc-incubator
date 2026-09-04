use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  DirectUpdateDisabled, FinalizeUpdate,
}
use ibc/client/ics_007_tendermint_client/multitx/types.{
  Cancel, CommitCore, Complete, Finalize, SessionDatum, UpdatePlan,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer
use spending_multitx_client

const validator_root =
  #"1111111111111111111111111111111111111111111111111111111111111111"

const app_hash =
  #"2222222222222222222222222222222222222222222222222222222222222222"

fn output_ref(byte: ByteArray, index: Int) -> OutputReference {
  OutputReference { transaction_id: byte, output_index: index }
}

fn script_output(
  script_hash: ByteArray,
  policy_id: PolicyId,
  token_name: ByteArray,
  datum: Data,
) -> Output {
  Output {
    address: from_script(script_hash),
    value: from_asset(policy_id, token_name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn target_header() -> TmHeader {
  TmHeader {
    ..tm_header_mod.null_tm_header(),
    version: Consensus { block: block_protocol, app: 0 },
    chain_id: "chain-0",
    height: 11,
    time: 1_500_000_000,
    validators_hash: validator_root,
    next_validators_hash: validator_root,
    app_hash,
  }
}

fn update_plan(client_token: AuthToken, trusted: ConsensusState) -> UpdatePlan {
  let tm_header = target_header()
  UpdatePlan {
    client_token,
    trusted_height: Height { revision_number: 0, revision_height: 10 },
    trusted_consensus_state: trusted,
    trust_level: unchecked_rational.new(1, 3),
    trusting_period: 10_000_000_000,
    max_clock_drift: 1_000_000_000,
    header: tm_header,
    commit: CommitCore {
      height: tm_header.height,
      round: 0,
      block_id: BlockID {
        hash: tm_header_mod.hash(tm_header),
        part_set_header: PartSetHeader { total: 1, hash: validator_root },
      },
    },
    target_validator_count: 1,
    trusted_validator_count: 0,
  }
}

fn client_input_datum(client_token: AuthToken) -> ClientDatum {
  let trusted_height = Height { revision_number: 0, revision_height: 10 }
  let trusted =
    ConsensusState {
      timestamp: 1_000_000_000,
      next_validators_hash: validator_root,
      root: merkle.new_merkle_root(app_hash),
    }
  ClientDatum {
    token: client_token,
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "chain-0",
        trust_level: unchecked_rational.new(1, 3),
        trusting_period: 10_000_000_000,
        unbonding_period: 20_000_000_000,
        max_clock_drift: 1_000_000_000,
        frozen_height: Height { revision_number: 0, revision_height: 0 },
        latest_height: trusted_height,
        proof_specs: [],
      },
      consensus_states: [Pair(trusted_height, trusted)],
      processed_times: [Pair(trusted_height, 0)],
      processed_heights: [Pair(trusted_height, 0)],
    },
  }
}

fn expected_client_output_datum(input: ClientDatum) -> ClientDatum {
  expect [Pair(_, trusted), ..] = input.state.consensus_states
  let plan = update_plan(input.token, trusted)
  let target =
    header.Header {
      signed_header: SignedHeader {
        header: plan.header,
        commit: Commit {
          height: plan.commit.height,
          round: plan.commit.round,
          block_id: plan.commit.block_id,
          signatures: [],
        },
      },
      validator_set: validator_set.null_validator_set(),
      trusted_height: plan.trusted_height,
      trusted_validators: validator_set.null_validator_set(),
    }
  let target_height = Height { revision_number: 0, revision_height: 11 }
  ClientDatum {
    ..input,
    state: ClientDatumState {
      client_state: ClientState {
        ..input.state.client_state,
        latest_height: target_height,
      },
      consensus_states: [
        Pair(target_height, header.consensus_state(target)),
        ..input.state.consensus_states
      ],
      processed_times: [
        Pair(target_height, 3_000_000_000),
        ..input.state.processed_times
      ],
      processed_heights: [
        Pair(
          target_height,
          client_datum_mod.processed_height_from_time(3_000_000_000),
        ),
        ..input.state.processed_heights
      ],
    },
  }
}

fn valid_context() -> (
  PolicyId,
  PolicyId,
  ClientDatum,
  AuthToken,
  OutputReference,
  Transaction,
) {
  let host_policy: PolicyId =
    #"33333333333333333333333333333333333333333333333333333333"
  let client_policy: PolicyId =
    #"44444444444444444444444444444444444444444444444444444444"
  let session_policy: PolicyId =
    #"55555555555555555555555555555555555555555555555555555555"
  let client_token = AuthToken { policy_id: client_policy, name: "client-0" }
  let session_token =
    AuthToken { policy_id: session_policy, name: validator_root }
  let input_datum = client_input_datum(client_token)
  expect [Pair(_, trusted), ..] = input_datum.state.consensus_states
  let plan = update_plan(client_token, trusted)
  let session_datum =
    SessionDatum {
      session_token,
      owner: #"66666666666666666666666666666666666666666666666666666666",
      plan,
      phase: Complete {
        target_root: validator_root,
        target_total_power: 10,
        target_signed_power: 10,
        trusted_root: None,
        trusted_total_power: 0,
        trusted_signed_power: 0,
      },
    }

  let client_ref =
    output_ref(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      0,
    )
  let session_ref =
    output_ref(
      #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      0,
    )
  let host_ref =
    output_ref(
      #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      0,
    )
  let client_input =
    Input {
      output_reference: client_ref,
      output: script_output(
        #"77777777777777777777777777777777777777777777777777777777",
        client_policy,
        client_token.name,
        input_datum,
      ),
    }
  let session_input =
    Input {
      output_reference: session_ref,
      output: script_output(
        #"88888888888888888888888888888888888888888888888888888888",
        session_policy,
        session_token.name,
        session_datum,
      ),
    }
  let host_input =
    Input {
      output_reference: host_ref,
      output: script_output(
        #"99999999999999999999999999999999999999999999999999999999",
        host_policy,
        host_state_token_name,
        Void,
      ),
    }
  let output_datum = expected_client_output_datum(input_datum)
  let client_output =
    Output { ..client_input.output, datum: InlineDatum(output_datum) }
  let host_output = host_input.output
  let host_redeemer: Redeemer =
    host_state_redeemer.UpdateClient {
      client_state_siblings: [],
      consensus_state_siblings: [],
      removed_consensus_state_siblings: [],
    }
  let session_redeemer: Redeemer = Finalize
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(host_ref), host_redeemer),
      Pair(Spend(session_ref), session_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [client_input, session_input, host_input],
      outputs: [client_output, host_output],
      mint: from_asset(session_policy, session_token.name, -1),
      redeemers,
      validity_range: interval.between(2_000, 3_000),
    }
  (
    host_policy,
    session_policy,
    input_datum,
    session_token,
    client_ref,
    transaction,
  )
}

fn completed_session_update_fixture_is_constructed(
  host_policy: PolicyId,
  session_policy: PolicyId,
  input_datum: ClientDatum,
  session_token: AuthToken,
  client_ref: OutputReference,
  transaction: Transaction,
) -> Bool {
  expect [client_input, session_input, host_input] = transaction.inputs
  and {
    host_policy != #"",
    session_policy == session_token.policy_id,
    input_datum.token.policy_id != #"",
    client_input.output_reference == client_ref,
    session_input.output_reference != client_ref,
    host_input.output_reference != client_ref,
  }
}

test completed_session_update_fixture_setup_baseline() {
  let (
    host_policy,
    session_policy,
    input_datum,
    session_token,
    client_ref,
    transaction,
  ) = valid_context()
  completed_session_update_fixture_is_constructed(
    host_policy,
    session_policy,
    input_datum,
    session_token,
    client_ref,
    transaction,
  )
}

test completed_session_updates_the_client_atomically() {
  let (
    host_policy,
    session_policy,
    input_datum,
    session_token,
    client_ref,
    transaction,
  ) = valid_context()
  expect
    completed_session_update_fixture_is_constructed(
      host_policy,
      session_policy,
      input_datum,
      session_token,
      client_ref,
      transaction,
    )
  spending_multitx_client.spend_multitx_client.spend(
    host_policy,
    session_policy,
    Some(input_datum),
    FinalizeUpdate { session_token },
    client_ref,
    transaction,
  )
}

test finalization_rejects_processing_time_from_chain_lower_bound() fail {
  let (
    host_policy,
    session_policy,
    input_datum,
    session_token,
    client_ref,
    transaction,
  ) = valid_context()
  expect [client_output, ..remaining_outputs] = transaction.outputs
  let output_datum = expected_client_output_datum(input_datum)
  expect [Pair(target_height, _), ..retained_times] =
    output_datum.state.processed_times
  let unsafe_output_datum =
    ClientDatum {
      ..output_datum,
      state: ClientDatumState {
        ..output_datum.state,
        processed_times: [Pair(target_height, 2_000_000_000), ..retained_times],
      },
    }
  let unsafe_client_output =
    Output { ..client_output, datum: InlineDatum(unsafe_output_datum) }
  spending_multitx_client.spend_multitx_client.spend(
    host_policy,
    session_policy,
    Some(input_datum),
    FinalizeUpdate { session_token },
    client_ref,
    Transaction {
      ..transaction,
      outputs: [unsafe_client_output, ..remaining_outputs],
    },
  )
}

test direct_update_constructor_is_disabled() {
  let (host_policy, session_policy, input_datum, _, client_ref, transaction) =
    valid_context()
  !spending_multitx_client.spend_multitx_client.spend(
    host_policy,
    session_policy,
    Some(input_datum),
    DirectUpdateDisabled,
    client_ref,
    transaction,
  )
}

test finalization_rejects_a_session_for_another_policy() fail {
  let (host_policy, _, input_datum, session_token, client_ref, transaction) =
    valid_context()
  spending_multitx_client.spend_multitx_client.spend(
    host_policy,
    #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    Some(input_datum),
    FinalizeUpdate { session_token },
    client_ref,
    transaction,
  )
}

test finalization_rejects_cancel_session_redeemer() fail {
  let (host_policy, _, input_datum, session_token, client_ref, transaction) =
    valid_context()
  expect [_, session_input, ..] = transaction.inputs
  let session_ref = session_input.output_reference
  expect [host_redeemer, ..] = transaction.redeemers
  let session_cancel: Redeemer = Cancel
  let cancel_redeemers: Pairs<ScriptPurpose, Redeemer> =
    [host_redeemer, Pair(Spend(session_ref), session_cancel)]
  spending_multitx_client.spend_multitx_client.spend(
    host_policy,
    session_token.policy_id,
    Some(input_datum),
    FinalizeUpdate { session_token },
    client_ref,
    Transaction { ..transaction, redeemers: cancel_redeemers },
  )
}
