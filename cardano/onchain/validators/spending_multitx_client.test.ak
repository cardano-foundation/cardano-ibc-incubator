use aiken/collection/list
use aiken/interval
use cardano/address.{Script, from_script}
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
  DirectUpdateDisabled, FinalizeMisbehaviour, FinalizeUpdate,
}
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  BurnSessions, Cancel, CommitCore, Complete, Finalize, SessionDatum, UpdatePlan,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer
use ibc/utils/validator_utils
use minting_tendermint_update_session
use spending_multitx_client
use spending_tendermint_update_session

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
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
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
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
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
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
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
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
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
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    Some(input_datum),
    FinalizeUpdate { session_token },
    client_ref,
    Transaction { ..transaction, redeemers: cancel_redeemers },
  )
}

fn frozen_client(datum: ClientDatum) -> ClientDatum {
  ClientDatum {
    ..datum,
    state: ClientDatumState {
      ..datum.state,
      client_state: ClientState {
        ..datum.state.client_state,
        frozen_height: Height { revision_number: 0, revision_height: 1 },
      },
    },
  }
}

fn replace_session_header(input: Input, header: TmHeader) -> Input {
  expect receipt: SessionDatum = validator_utils.get_inline_datum(input.output)
  let plan =
    UpdatePlan {
      ..receipt.plan,
      header,
      commit: CommitCore {
        ..receipt.plan.commit,
        height: header.height,
        block_id: BlockID {
          ..receipt.plan.commit.block_id,
          hash: tm_header_mod.hash(header),
        },
      },
      trusted_validator_count: if header.height == receipt.plan.trusted_height.revision_height + 1 {
        0
      } else {
        1
      },
    }
  let phase =
    Complete {
      target_root: validator_root,
      target_total_power: 10,
      target_signed_power: 10,
      trusted_root: if plan.trusted_validator_count == 0 {
        None
      } else {
        Some(validator_root)
      },
      trusted_total_power: if plan.trusted_validator_count == 0 {
        0
      } else {
        10
      },
      trusted_signed_power: if plan.trusted_validator_count == 0 {
        0
      } else {
        10
      },
    }
  let changed: Data = SessionDatum { ..receipt, plan, phase }
  Input {
    ..input,
    output: Output { ..input.output, datum: InlineDatum(changed) },
  }
}

fn evidence_context() -> Transaction {
  let (_, session_policy, client, _, _, tx) = valid_context()
  expect [client_input, first, host] = tx.inputs
  expect receipt: SessionDatum = validator_utils.get_inline_datum(first.output)
  let second_token = AuthToken { policy_id: session_policy, name: app_hash }
  let second_datum: Data =
    SessionDatum { ..receipt, session_token: second_token }
  let second =
    Input {
      output_reference: output_ref(
        #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        0,
      ),
      output: Output {
        ..first.output,
        value: from_asset(session_policy, second_token.name, 1),
        datum: InlineDatum(second_datum),
      },
    }
  let second =
    replace_session_header(
      second,
      TmHeader { ..target_header(), app_hash: validator_root },
    )
  let frozen: Data = frozen_client(client)
  let finalize: Data = Finalize
  Transaction {
    ..tx,
    inputs: [client_input, first, second, host],
    outputs: [
      Output { ..client_input.output, datum: InlineDatum(frozen) },
      host.output,
    ],
    mint: assets.add(tx.mint, session_policy, second_token.name, -1),
    extra_signatories: [receipt.owner],
    redeemers: [Pair(Spend(second.output_reference), finalize), ..tx.redeemers],
  }
}

fn verify_evidence(tx: Transaction) -> Bool {
  expect [client_input, first, second, host] = tx.inputs
  expect client: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect first_datum: SessionDatum =
    validator_utils.get_inline_datum(first.output)
  expect second_datum: SessionDatum =
    validator_utils.get_inline_datum(second.output)
  expect Script(host_policy) = host.output.address.payment_credential
  // The fixture HostState address is distinct from its NFT policy.
  expect host_policy != first_datum.session_token.policy_id
  spending_multitx_client.spend_multitx_client.spend(
    #"33333333333333333333333333333333333333333333333333333333",
    first_datum.session_token.policy_id,
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    Some(client),
    FinalizeMisbehaviour {
      session_token_1: first_datum.session_token,
      session_token_2: second_datum.session_token,
    },
    client_input.output_reference,
    tx,
  )
}

test evidence_two_header_fixture_setup_baseline() {
  let tx = evidence_context()
  expect [_, first, second, _] = tx.inputs
  first.output_reference != second.output_reference && list.length(tx.outputs) == 2
}

test evidence_two_conflicting_headers_freeze_without_changing_history() {
  verify_evidence(evidence_context())
}

test evidence_finalization_validates_both_sessions_and_exact_burn_policy() {
  let tx = evidence_context()
  expect [_, first, second, _] = tx.inputs
  expect first_datum: SessionDatum =
    validator_utils.get_inline_datum(first.output)
  expect second_datum: SessionDatum =
    validator_utils.get_inline_datum(second.output)
  expect Script(session_script) = first.output.address.payment_credential
  and {
    verify_evidence(tx),
    spending_tendermint_update_session.spend_tendermint_update_session.spend(
      #"33333333333333333333333333333333333333333333333333333333",
      Some(first_datum),
      Finalize,
      first.output_reference,
      tx,
    ),
    spending_tendermint_update_session.spend_tendermint_update_session.spend(
      #"33333333333333333333333333333333333333333333333333333333",
      Some(second_datum),
      Finalize,
      second.output_reference,
      tx,
    ),
    minting_tendermint_update_session.mint_tendermint_update_session.mint(
      session_script,
      BurnSessions {
        token_names: [
          first_datum.session_token.name,
          second_datum.session_token.name,
        ],
      },
      first_datum.session_token.policy_id,
      tx,
    ),
  }
}

test evidence_rejects_identical_headers() {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  !verify_evidence(
    Transaction {
      ..tx,
      inputs: [
        client,
        first,
        replace_session_header(second, target_header()),
        host,
      ],
    },
  )
}

test evidence_accepts_time_violation_regardless_of_header_order() {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  let later =
    replace_session_header(
      second,
      TmHeader { ..target_header(), height: 12, time: 1_400_000_000 },
    )
  and {
    verify_evidence(Transaction { ..tx, inputs: [client, first, later, host] }),
    verify_evidence(Transaction { ..tx, inputs: [client, later, first, host] }),
  }
}

test evidence_rejects_distinct_nonconflicting_heights() {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  let later =
    replace_session_header(
      second,
      TmHeader { ..target_header(), height: 12, time: 1_600_000_000 },
    )
  !verify_evidence(Transaction { ..tx, inputs: [client, first, later, host] })
}

test evidence_does_not_apply_normal_header_clock_or_monotonicity_checks() {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  let early =
    replace_session_header(
      first,
      TmHeader { ..target_header(), time: 500_000_000 },
    )
  let future =
    replace_session_header(
      second,
      TmHeader { ..target_header(), time: 100_000_000_000 },
    )
  verify_evidence(Transaction { ..tx, inputs: [client, early, future, host] })
}

test evidence_rejects_expired_trusted_states() fail {
  verify_evidence(
    Transaction {
      ..evidence_context(),
      validity_range: interval.between(12_000, 13_000),
    },
  )
}

test evidence_rejects_foreign_client_session() fail {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  expect datum: SessionDatum = validator_utils.get_inline_datum(second.output)
  let foreign: Data =
    SessionDatum {
      ..datum,
      plan: UpdatePlan {
        ..datum.plan,
        client_token: AuthToken { ..datum.plan.client_token, name: "client-1" },
      },
    }
  verify_evidence(
    Transaction {
      ..tx,
      inputs: [
        client,
        first,
        Input {
          ..second,
          output: Output { ..second.output, datum: InlineDatum(foreign) },
        },
        host,
      ],
    },
  )
}

test evidence_rejects_incomplete_session() fail {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  expect datum: SessionDatum = validator_utils.get_inline_datum(second.output)
  let incomplete: Data =
    session.initial_datum(datum.session_token, datum.owner, datum.plan)
  verify_evidence(
    Transaction {
      ..tx,
      inputs: [
        client,
        first,
        Input {
          ..second,
          output: Output { ..second.output, datum: InlineDatum(incomplete) },
        },
        host,
      ],
    },
  )
}

test evidence_rejects_forged_trusted_consensus_state() fail {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  expect datum: SessionDatum = validator_utils.get_inline_datum(second.output)
  let forged: Data =
    SessionDatum {
      ..datum,
      plan: UpdatePlan {
        ..datum.plan,
        trusted_consensus_state: ConsensusState {
          ..datum.plan.trusted_consensus_state,
          timestamp: 900_000_000,
        },
      },
    }
  verify_evidence(
    Transaction {
      ..tx,
      inputs: [
        client,
        first,
        Input {
          ..second,
          output: Output { ..second.output, datum: InlineDatum(forged) },
        },
        host,
      ],
    },
  )
}

test evidence_rejects_another_session_owner() fail {
  let tx = evidence_context()
  expect [client, first, second, host] = tx.inputs
  expect datum: SessionDatum = validator_utils.get_inline_datum(second.output)
  let changed: Data =
    SessionDatum {
      ..datum,
      owner: #"abababababababababababababababababababababababababababab",
    }
  verify_evidence(
    Transaction {
      ..tx,
      inputs: [
        client,
        first,
        Input {
          ..second,
          output: Output { ..second.output, datum: InlineDatum(changed) },
        },
        host,
      ],
    },
  )
}

test evidence_rejects_frozen_client() fail {
  let tx = evidence_context()
  expect [client, ..rest] = tx.inputs
  expect datum: ClientDatum = validator_utils.get_inline_datum(client.output)
  let frozen: Data = frozen_client(datum)
  verify_evidence(
    Transaction {
      ..tx,
      inputs: [
        Input {
          ..client,
          output: Output { ..client.output, datum: InlineDatum(frozen) },
        },
        ..rest
      ],
    },
  )
}

test evidence_rejects_output_history_mutation() {
  let tx = evidence_context()
  expect [client, ..rest] = tx.outputs
  expect datum: ClientDatum = validator_utils.get_inline_datum(client)
  let changed: Data =
    ClientDatum {
      ..datum,
      state: ClientDatumState { ..datum.state, consensus_states: [] },
    }
  !verify_evidence(
    Transaction {
      ..tx,
      outputs: [Output { ..client, datum: InlineDatum(changed) }, ..rest],
    },
  )
}

test evidence_rejects_missing_burn() fail {
  let tx = evidence_context()
  verify_evidence(Transaction { ..tx, mint: assets.zero })
}

test evidence_rejects_missing_session_authorization() fail {
  verify_evidence(Transaction { ..evidence_context(), redeemers: [] })
}

test evidence_rejects_additional_session_mint() fail {
  let tx = evidence_context()
  verify_evidence(
    Transaction {
      ..tx,
      mint: assets.add(
        tx.mint,
        #"55555555555555555555555555555555555555555555555555555555",
        "extra",
        1,
      ),
    },
  )
}

fn header_conflict_context() -> (
  ClientDatum,
  AuthToken,
  OutputReference,
  Transaction,
) {
  let (_, _, original, token, client_ref, tx) = valid_context()
  let client = expected_client_output_datum(original)
  expect [client_input, session_input, host] = tx.inputs
  let old: Data = client
  let frozen: Data = frozen_client(client)
  let conflicting =
    replace_session_header(
      session_input,
      TmHeader { ..target_header(), app_hash: validator_root },
    )
  (
    client,
    token,
    client_ref,
    Transaction {
      ..tx,
      inputs: [
        Input {
          ..client_input,
          output: Output { ..client_input.output, datum: InlineDatum(old) },
        },
        conflicting,
        host,
      ],
      outputs: [
        Output { ..client_input.output, datum: InlineDatum(frozen) },
        host.output,
      ],
    },
  )
}

test header_conflicting_with_retained_height_freezes_client() {
  let (client, token, client_ref, tx) = header_conflict_context()
  spending_multitx_client.spend_multitx_client.spend(
    #"33333333333333333333333333333333333333333333333333333333",
    token.policy_id,
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    Some(client),
    FinalizeUpdate { session_token: token },
    client_ref,
    tx,
  )
}

test header_time_violation_against_retained_height_freezes_client() {
  let (client, token, client_ref, tx) = header_conflict_context()
  expect [client_input, receipt, host] = tx.inputs
  let later =
    replace_session_header(
      receipt,
      TmHeader { ..target_header(), height: 12, time: 1_400_000_000 },
    )
  spending_multitx_client.spend_multitx_client.spend(
    #"33333333333333333333333333333333333333333333333333333333",
    token.policy_id,
    Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    Some(client),
    FinalizeUpdate { session_token: token },
    client_ref,
    Transaction { ..tx, inputs: [client_input, later, host] },
  )
}
