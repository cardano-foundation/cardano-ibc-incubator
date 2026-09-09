use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/fuzz
use aiken/interval
use cardano/address
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, Withdraw,
}
use host_state_stt
use ibc/auth.{AuthToken, generate_token_name}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  ArchiveConsensusState, RecoverClient, RecoverClientWithdrawal,
  RecoverClientWithdrawalRedeemer,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/testing/sparse_tree
use minting_client_stt
use recover_client
use spending_client

const host_policy = #"11111111111111111111111111111111111111111111111111111111"

const client_policy =
  #"22222222222222222222222222222222222222222222222222222222"

const other_client_policy =
  #"23232323232323232323232323232323232323232323232323232323"

const host_script_hash =
  #"33333333333333333333333333333333333333333333333333333333"

const client_script_hash =
  #"44444444444444444444444444444444444444444444444444444444"

const other_client_script_hash =
  #"45454545454545454545454545454545454545454545454545454545"

const recovery_script_hash =
  #"55555555555555555555555555555555555555555555555555555555"

const consensus_script_hash =
  #"56565656565656565656565656565656565656565656565656565656"

const connection_script_hash =
  #"57575757575757575757575757575757575757575757575757575757"

const channel_script_hash =
  #"58585858585858585858585858585858585858585858585858585858"

const deployer = #"66666666666666666666666666666666666666666666666666666666"

const subject_name = #"681612818cdd9151d976a929debffdcf3ec5f872f2c9db6430"

const substitute_name = #"681612818cdd9151d976a929debffdcf3ec5f872f2c9db6431"

const trusting_period = 1_000_000_000

const active_timestamp = 1_500_000_000

fn subject_token() -> AuthToken {
  AuthToken { policy_id: client_policy, name: subject_name }
}

fn substitute_token() -> AuthToken {
  AuthToken { policy_id: client_policy, name: substitute_name }
}

test recovery_token_names_match_client_stt_derivation() {
  let host_token =
    AuthToken { policy_id: host_policy, name: host_state_token_name }

  and {
    subject_name == generate_token_name(host_token, client_prefix, "0"),
    substitute_name == generate_token_name(host_token, client_prefix, "1"),
  }
}

fn height(value: Int) -> Height {
  Height { revision_number: 1, revision_height: value }
}

fn zero_height() -> Height {
  Height { revision_number: 0, revision_height: 0 }
}

fn consensus(timestamp: Int, marker: ByteArray) -> ConsensusState {
  ConsensusState {
    timestamp,
    next_validators_hash: marker,
    root: merkle.new_merkle_root(marker),
  }
}

fn client_state(latest_height: Height, frozen_height: Height) -> ClientState {
  ClientState {
    chain_id: "chain-1",
    trust_level: unchecked_rational.new(1, 3),
    trusting_period,
    unbonding_period: 2_000_000_000,
    max_clock_drift: 1_000_000,
    frozen_height,
    latest_height,
    proof_specs: [],
  }
}

fn datum(
  token: AuthToken,
  latest_height: Height,
  timestamp: Int,
  frozen_height: Height,
) -> ClientDatum {
  let consensus_states = [Pair(latest_height, consensus(timestamp, token.name))]
  ClientDatum {
    state: ClientDatumState {
      client_state: client_state(latest_height, frozen_height),
      consensus_states,
      processed_times: [Pair(latest_height, timestamp)],
      processed_heights: [Pair(latest_height, latest_height.revision_height)],
    },
    token,
  }
}

fn expired_subject() -> ClientDatum {
  datum(subject_token(), height(10), 0, zero_height())
}

fn frozen_subject() -> ClientDatum {
  datum(subject_token(), height(10), active_timestamp, height(7))
}

fn active_substitute() -> ClientDatum {
  datum(substitute_token(), height(20), active_timestamp, zero_height())
}

fn expected_recovered(
  subject: ClientDatum,
  substitute: ClientDatum,
) -> ClientDatum {
  let substitute_height = substitute.state.client_state.latest_height
  expect Some(substitute_consensus) =
    pairs.get_first(substitute.state.consensus_states, substitute_height)
  expect Some(substitute_time) =
    pairs.get_first(substitute.state.processed_times, substitute_height)
  expect Some(substitute_processed_height) =
    pairs.get_first(substitute.state.processed_heights, substitute_height)

  ClientDatum {
    ..subject,
    state: ClientDatumState {
      client_state: ClientState {
        ..subject.state.client_state,
        frozen_height: zero_height(),
        latest_height: substitute_height,
      },
      consensus_states: [Pair(substitute_height, substitute_consensus)],
      processed_times: [Pair(substitute_height, substitute_time)],
      processed_heights: [Pair(substitute_height, substitute_processed_height)],
    },
  }
}

const host_reference =
  OutputReference {
    transaction_id: #"7777777777777777777777777777777777777777777777777777777777777777",
    output_index: 0,
  }

const subject_reference =
  OutputReference {
    transaction_id: #"8888888888888888888888888888888888888888888888888888888888888888",
    output_index: 0,
  }

const substitute_reference =
  OutputReference {
    transaction_id: #"9999999999999999999999999999999999999999999999999999999999999999",
    output_index: 0,
  }

fn host_datum() -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: 0,
      ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
      next_client_sequence: 2,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    },
    nft_policy: host_policy,
    deployer,
    control: HostStateControl { port_registry: [], shutdown: Active },
  }
}

fn host_datum_at(root: ByteArray, version: Int) -> HostStateDatum {
  let base = host_datum()
  HostStateDatum {
    ..base,
    state: HostState { ..base.state, version, ibc_state_root: root },
  }
}

fn client_output(client_datum: ClientDatum, script_hash: ByteArray) -> Output {
  Output {
    address: address.from_script(script_hash),
    value: from_asset(client_datum.token.policy_id, client_datum.token.name, 1),
    datum: InlineDatum(client_datum),
    reference_script: None,
  }
}

fn host_output_with_datum(datum: HostStateDatum) -> Output {
  Output {
    address: address.from_script(host_script_hash),
    value: from_asset(host_policy, host_state_token_name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn recovery_redeemer(
  subject: ClientDatum,
  substitute: ClientDatum,
) -> RecoverClientWithdrawalRedeemer {
  RecoverClientWithdrawal {
    subject_token: subject.token,
    substitute_token: substitute.token,
  }
}

fn recovery_transaction_with_host(
  subject: ClientDatum,
  substitute: ClientDatum,
  recovered: ClientDatum,
  substitute_script_hash: ByteArray,
  signers: List<ByteArray>,
  include_withdrawal: Bool,
  include_withdrawal_redeemer: Bool,
  old_host_datum: HostStateDatum,
  new_host_datum: HostStateDatum,
  host_update_redeemer: host_state_redeemer.HostStateRedeemer,
) -> Transaction {
  let host_input =
    Input {
      output_reference: host_reference,
      output: host_output_with_datum(old_host_datum),
    }
  let subject_input =
    Input {
      output_reference: subject_reference,
      output: client_output(subject, client_script_hash),
    }
  let substitute_input =
    Input {
      output_reference: substitute_reference,
      output: client_output(substitute, substitute_script_hash),
    }
  let host_redeemer: Redeemer = host_update_redeemer
  let subject_redeemer: Redeemer =
    RecoverClient { substitute_token: substitute.token }
  let withdrawal_redeemer: Redeemer = recovery_redeemer(subject, substitute)
  let record = consensus_history.from_client(subject)
  let archive_token = consensus_history.token(subject.token, record.height)
  let archive_redeemer: Redeemer =
    ArchiveConsensusState { client_token: subject.token }
  let base_redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(host_reference), host_redeemer),
      Pair(Spend(subject_reference), subject_redeemer),
      Pair(Mint(client_policy), archive_redeemer),
    ]
  let redeemers =
    if include_withdrawal_redeemer {
      [
        Pair(
          Withdraw(address.Script(recovery_script_hash)),
          withdrawal_redeemer,
        ),
        ..base_redeemers
      ]
    } else {
      base_redeemers
    }
  let withdrawals =
    if include_withdrawal {
      [Pair(address.Script(recovery_script_hash), 0)]
    } else {
      []
    }

  Transaction {
    ..transaction.placeholder,
    inputs: [host_input, subject_input],
    reference_inputs: [substitute_input],
    outputs: [
      client_output(recovered, client_script_hash),
      host_output_with_datum(new_host_datum),
      Output {
        address: address.from_script(consensus_script_hash),
        value: from_asset(archive_token.policy_id, archive_token.name, 1),
        datum: InlineDatum(record),
        reference_script: None,
      },
    ],
    mint: from_asset(archive_token.policy_id, archive_token.name, 1),
    withdrawals,
    validity_range: interval.between(1900, 2000),
    extra_signatories: signers,
    redeemers,
  }
}

fn recovery_transaction(
  subject: ClientDatum,
  substitute: ClientDatum,
  recovered: ClientDatum,
  substitute_script_hash: ByteArray,
  signers: List<ByteArray>,
  include_withdrawal: Bool,
  include_withdrawal_redeemer: Bool,
) -> Transaction {
  recovery_transaction_with_host(
    subject,
    substitute,
    recovered,
    substitute_script_hash,
    signers,
    include_withdrawal,
    include_withdrawal_redeemer,
    host_datum(),
    host_datum(),
    host_state_redeemer.UpdateClient {
      client_state_siblings: [],
      consensus_state_siblings: [],
      removed_consensus_state_siblings: [],
    },
  )
}

fn run_recovery(
  subject: ClientDatum,
  substitute: ClientDatum,
  recovered: ClientDatum,
  substitute_script_hash: ByteArray,
  signers: List<ByteArray>,
) -> Bool {
  recover_client.recover_client.withdraw(
    host_policy,
    recovery_redeemer(subject, substitute),
    address.Script(recovery_script_hash),
    recovery_transaction(
      subject,
      substitute,
      recovered,
      substitute_script_hash,
      signers,
      True,
      True,
    ),
  )
}

fn run_atomic_recovery(correct_output_root: Bool) -> Bool {
  run_atomic_recovery_with_policy(correct_output_root, client_policy, True)
}

fn run_atomic_recovery_with_policy(
  correct_output_root: Bool,
  actual_client_policy: ByteArray,
  verify_host_state: Bool,
) -> Bool {
  let original_subject = frozen_subject()
  let original_substitute = active_substitute()
  let subject =
    ClientDatum {
      ..original_subject,
      token: AuthToken {
        ..original_subject.token,
        policy_id: actual_client_policy,
      },
    }
  let substitute =
    ClientDatum {
      ..original_substitute,
      token: AuthToken {
        ..original_substitute.token,
        policy_id: actual_client_policy,
      },
    }
  let recovered = expected_recovered(subject, substitute)
  let subject_client_key = client_keys.full_client_state_path("07-tendermint-0")
  let subject_old_consensus_key =
    client_keys.full_client_consensus_state_path("07-tendermint-0", "10")
  let subject_new_consensus_key =
    client_keys.full_client_consensus_state_path("07-tendermint-0", "20")
  let substitute_client_key =
    client_keys.full_client_state_path("07-tendermint-1")
  let substitute_consensus_key =
    client_keys.full_client_consensus_state_path("07-tendermint-1", "20")
  expect Some(subject_old_consensus) =
    pairs.get_first(subject.state.consensus_states, height(10))
  expect Some(subject_new_consensus) =
    pairs.get_first(substitute.state.consensus_states, height(20))
  expect Some(substitute_consensus) =
    pairs.get_first(substitute.state.consensus_states, height(20))
  let old_entries: Pairs<ByteArray, ByteArray> =
    [
      Pair(subject_client_key, cbor.serialise(subject.state.client_state)),
      Pair(subject_old_consensus_key, cbor.serialise(subject_old_consensus)),
      Pair(substitute_client_key, cbor.serialise(substitute.state.client_state)),
      Pair(substitute_consensus_key, cbor.serialise(substitute_consensus)),
    ]
  let old_root = sparse_tree.root(old_entries)
  let client_state_siblings =
    sparse_tree.siblings(old_entries, subject_client_key)
  let root_after_client_update =
    ibc_state_commitment.apply_update(
      old_root,
      subject_client_key,
      cbor.serialise(subject.state.client_state),
      cbor.serialise(recovered.state.client_state),
      client_state_siblings,
    )
  let entries_after_client_update: Pairs<ByteArray, ByteArray> =
    [
      Pair(subject_client_key, cbor.serialise(recovered.state.client_state)),
      Pair(subject_old_consensus_key, cbor.serialise(subject_old_consensus)),
      Pair(substitute_client_key, cbor.serialise(substitute.state.client_state)),
      Pair(substitute_consensus_key, cbor.serialise(substitute_consensus)),
    ]
  expect
    root_after_client_update == sparse_tree.root(entries_after_client_update)
  let consensus_state_siblings =
    sparse_tree.siblings(entries_after_client_update, subject_new_consensus_key)
  let new_root =
    ibc_state_commitment.apply_update(
      root_after_client_update,
      subject_new_consensus_key,
      "",
      cbor.serialise(subject_new_consensus),
      consensus_state_siblings,
    )
  let final_entries: Pairs<ByteArray, ByteArray> =
    [
      Pair(subject_new_consensus_key, cbor.serialise(subject_new_consensus)),
      ..entries_after_client_update
    ]
  expect new_root == sparse_tree.root(final_entries)
  let old_host_datum = host_datum_at(old_root, 0)
  let output_root =
    if correct_output_root {
      new_root
    } else {
      old_root
    }
  let new_host_datum = host_datum_at(output_root, 1)
  let host_update_redeemer =
    host_state_redeemer.UpdateClient {
      client_state_siblings,
      consensus_state_siblings,
      removed_consensus_state_siblings: [],
    }
  let transaction =
    recovery_transaction_with_host(
      subject,
      substitute,
      recovered,
      client_script_hash,
      [deployer],
      True,
      True,
      old_host_datum,
      new_host_datum,
      host_update_redeemer,
    )

  and {
    minting_client_stt.mint_client_stt.mint(
      client_script_hash,
      host_policy,
      consensus_script_hash,
      ArchiveConsensusState { client_token: subject.token },
      client_policy,
      transaction,
    ),
    spending_client.spend_client.spend(
      host_policy,
      address.Script(recovery_script_hash),
      Some(subject),
      RecoverClient { substitute_token: substitute.token },
      subject_reference,
      transaction,
    )
  expect
    recover_client.recover_client.withdraw(
      host_policy,
      recovery_redeemer(subject, substitute),
      address.Script(recovery_script_hash),
      transaction,
    )
  if verify_host_state {
    host_state_stt.host_state_stt.spend(
      host_policy,
      client_script_hash,
      connection_script_hash,
      channel_script_hash,
      client_policy,
      Some(old_host_datum),
      host_update_redeemer,
      host_reference,
      transaction,
    )
  } else {
    True
  }
}

test atomic_recovery_all_validators_accept_real_root_transition() {
  run_atomic_recovery(True)
}

test atomic_recovery_host_rejects_wrong_committed_root() fail {
  run_atomic_recovery(False)
}

test atomic_recovery_host_rejects_counterfeit_client_policy() fail {
  run_atomic_recovery_with_policy(True, other_client_policy, True)
}

test counterfeit_recovery_pair_passes_local_validators() {
  run_atomic_recovery_with_policy(True, other_client_policy, False)
}

test recover_state_copies_checkpoint_and_clears_frozen() {
  let subject = frozen_subject()
  let substitute = active_substitute()
  client_datum_mod.recover_state(
    subject,
    substitute,
    expected_recovered(subject, substitute),
  )
}

fn history(first_height: Int, count: Int) -> Pairs<Height, ConsensusState> {
  if count <= 0 {
    []
  } else {
    [
      Pair(height(first_height), consensus(0, #"01")),
      ..history(first_height - 1, count - 1)
    ]
  }
}

fn subject_with_history(history_size: Int) -> ClientDatum {
  let consensus_states = history(history_size, history_size)
  ClientDatum {
    state: ClientDatumState {
      client_state: client_state(height(history_size), zero_height()),
      consensus_states,
      processed_times: list.map(
        consensus_states,
        fn(pair) { Pair(pair.1st, 0) },
      ),
      processed_heights: list.map(
        consensus_states,
        fn(pair) { Pair(pair.1st, pair.1st.revision_height) },
      ),
    },
    token: subject_token(),
  }
}

fn substitute_after(history_size: Int) -> ClientDatum {
  datum(
    substitute_token(),
    height(history_size + 1),
    active_timestamp,
    zero_height(),
  )
}

test recovery_rejects_legacy_300_entry_datum() fail {
  let subject = subject_with_history(300)
  let substitute = substitute_after(300)
  client_datum_mod.recover_state(
    subject,
    substitute,
    expected_recovered(subject, substitute),
  )
}

test recovery_keeps_one_tip_after_300_updates() {
  // The previous 299 records live in separate UTxOs and are not recovery inputs.
  let subject = datum(subject_token(), height(300), 0, zero_height())
  let substitute = substitute_after(300)
  let recovered = expected_recovered(subject, substitute)
  let transaction =
    recovery_transaction(
      subject,
      substitute,
      recovered,
      client_script_hash,
      [deployer],
      True,
      True,
    )
  and {
    client_datum_mod.recover_state(subject, substitute, recovered),
    list.length(recovered.state.consensus_states) == 1,
    list.length(recovered.state.processed_times) == 1,
    list.length(recovered.state.processed_heights) == 1,
    list.length(transaction.inputs) == 2,
    list.length(transaction.reference_inputs) == 1,
    list.length(transaction.outputs) == 3,
    list.length(transaction.redeemers) == 4,
    run_recovery(subject, substitute, recovered, client_script_hash, [deployer]),
  }
}

test recovery_parameters_reject_chain_id_change() fail {
  let subject = expired_subject()
  let substitute = active_substitute()
  let incompatible_substitute =
    ClientDatum {
      ..substitute,
      state: ClientDatumState {
        ..substitute.state,
        client_state: ClientState {
          ..substitute.state.client_state,
          chain_id: "another-chain-1",
        },
      },
    }
  client_datum_mod.recover_state(
    subject,
    incompatible_substitute,
    expected_recovered(subject, incompatible_substitute),
  )
}

test recovery_parameters_require_exact_immutable_fields() {
  let subject = expired_subject().state.client_state

  and {
    !client_datum_mod.recovery_parameters_match(
      subject,
      ClientState { ..subject, chain_id: "another-chain-1" },
    ),
    !client_datum_mod.recovery_parameters_match(
      subject,
      ClientState { ..subject, trust_level: unchecked_rational.new(2, 3) },
    ),
    !client_datum_mod.recovery_parameters_match(
      subject,
      ClientState { ..subject, trusting_period: trusting_period + 1 },
    ),
    !client_datum_mod.recovery_parameters_match(
      subject,
      ClientState { ..subject, unbonding_period: subject.unbonding_period + 1 },
    ),
    !client_datum_mod.recovery_parameters_match(
      subject,
      ClientState { ..subject, max_clock_drift: subject.max_clock_drift + 1 },
    ),
    !client_datum_mod.recovery_parameters_match(
      subject,
      ClientState { ..subject, proof_specs: merkle.get_sdk_specs() },
    ),
    client_datum_mod.recovery_parameters_match(
      subject,
      ClientState {
        ..subject,
        frozen_height: height(1),
        latest_height: height(20),
      },
    ),
  }
}

test recover_client_accepts_expired_subject() {
  let subject = expired_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test recover_client_accepts_frozen_subject() {
  let subject = frozen_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test prop_client_recovery_accepts_expired_subject(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.client.recovery.valid_expired")

  let subject = expired_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test prop_client_recovery_accepts_frozen_subject(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.client.recovery.valid_frozen")

  let subject = frozen_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test recover_client_rejects_missing_authority() fail {
  let subject = expired_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [],
  )
}

test prop_client_recovery_rejects_missing_authority(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.client.recovery.invalid_missing_authority")

  let subject = expired_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [],
  )
}

test recover_client_rejects_active_subject() fail {
  let subject =
    datum(subject_token(), height(10), active_timestamp, zero_height())
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test recover_client_rejects_inactive_substitute() fail {
  let subject = expired_subject()
  let substitute = datum(substitute_token(), height(20), 0, zero_height())
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test recover_client_rejects_substitute_that_is_not_newer() fail {
  let subject = expired_subject()
  let substitute =
    datum(substitute_token(), height(9), active_timestamp, zero_height())
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test recover_client_rejects_different_client_address() fail {
  let subject = expired_subject()
  let substitute = active_substitute()
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    other_client_script_hash,
    [deployer],
  )
}

test recover_client_rejects_different_token_policy() fail {
  let subject = expired_subject()
  let substitute = active_substitute()
  let wrong_policy_substitute =
    ClientDatum {
      ..substitute,
      token: AuthToken { ..substitute.token, policy_id: other_client_policy },
    }
  run_recovery(
    subject,
    wrong_policy_substitute,
    expected_recovered(subject, wrong_policy_substitute),
    client_script_hash,
    [deployer],
  )
}

test spend_client_forwards_valid_recovery() {
  let subject = expired_subject()
  let substitute = active_substitute()
  spending_client.spend_client.spend(
    host_policy,
    address.Script(recovery_script_hash),
    Some(subject),
    RecoverClient { substitute_token: substitute.token },
    subject_reference,
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      True,
      True,
    ),
  )
}

test spend_client_rejects_missing_recovery_withdrawal() fail {
  let subject = expired_subject()
  let substitute = active_substitute()
  spending_client.spend_client.spend(
    host_policy,
    address.Script(recovery_script_hash),
    Some(subject),
    RecoverClient { substitute_token: substitute.token },
    subject_reference,
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      False,
      False,
    ),
  )
}

fn spend_with_withdrawal_redeemer(withdrawal_redeemer: Redeemer) -> Bool {
  let subject = expired_subject()
  let substitute = active_substitute()
  let tx =
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      True,
      False,
    )
  spending_client.spend_client.spend(
    host_policy,
    address.Script(recovery_script_hash),
    Some(subject),
    RecoverClient { substitute_token: substitute.token },
    subject_reference,
    Transaction {
      ..tx,
      redeemers: [
        Pair(
          Withdraw(address.Script(recovery_script_hash)),
          withdrawal_redeemer,
        ),
        ..tx.redeemers
      ],
    },
  )
}

test spend_client_rejects_recovery_for_another_subject() {
  !spend_with_withdrawal_redeemer(
    RecoverClientWithdrawal {
      subject_token: AuthToken {
        ..subject_token(),
        policy_id: other_client_policy,
      },
      substitute_token: substitute_token(),
    },
  )
}

test spend_client_rejects_recovery_from_another_substitute() {
  !spend_with_withdrawal_redeemer(
    RecoverClientWithdrawal {
      subject_token: subject_token(),
      substitute_token: AuthToken {
        ..substitute_token(),
        policy_id: other_client_policy,
      },
    },
  )
}

test spend_client_rejects_malformed_recovery_withdrawal() {
  !spend_with_withdrawal_redeemer(Void)
}

test unrelated_valid_recovery_cannot_authorize_a_real_client_spend() {
  let subject = expired_subject()
  let substitute = active_substitute()
  let fake_subject =
    ClientDatum {
      ..subject,
      token: AuthToken { ..subject.token, policy_id: other_client_policy },
    }
  let fake_substitute =
    ClientDatum {
      ..substitute,
      token: AuthToken { ..substitute.token, policy_id: other_client_policy },
    }
  let fake_reference = OutputReference { ..subject_reference, output_index: 1 }
  let fake_substitute_reference =
    OutputReference { ..substitute_reference, output_index: 1 }
  let tx =
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      True,
      False,
    )
  let fake_spend_redeemer: Redeemer =
    RecoverClient { substitute_token: fake_substitute.token }
  let fake_withdrawal_redeemer: Redeemer =
    recovery_redeemer(fake_subject, fake_substitute)
  let tx =
    Transaction {
      ..tx,
      inputs: [
        Input {
          output_reference: fake_reference,
          output: client_output(fake_subject, other_client_script_hash),
        },
        ..tx.inputs
      ],
      reference_inputs: [
        Input {
          output_reference: fake_substitute_reference,
          output: client_output(fake_substitute, other_client_script_hash),
        },
        ..tx.reference_inputs
      ],
      outputs: [
        client_output(
          expected_recovered(fake_subject, fake_substitute),
          other_client_script_hash,
        ),
        ..tx.outputs
      ],
      redeemers: [
        Pair(Spend(fake_reference), fake_spend_redeemer),
        Pair(
          Withdraw(address.Script(recovery_script_hash)),
          fake_withdrawal_redeemer,
        ),
        ..tx.redeemers
      ],
    }
  expect
    recover_client.recover_client.withdraw(
      host_policy,
      recovery_redeemer(fake_subject, fake_substitute),
      address.Script(recovery_script_hash),
      tx,
    )
  !spending_client.spend_client.spend(
    host_policy,
    address.Script(recovery_script_hash),
    Some(subject),
    RecoverClient { substitute_token: substitute.token },
    subject_reference,
    tx,
  )
}
