use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/fuzz
use aiken/interval
use aiken/math
use cardano/address
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction, Withdraw,
}
use host_state_stt
use ibc/auth.{AuthToken, generate_token_name}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  RecoverClient, RecoverClientWithdrawal, RecoverClientWithdrawalRedeemer,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_consensus_state_size,
}
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
use ibc/utils/bits
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

const connection_script_hash =
  #"57575757575757575757575757575757575757575757575757575757"

const channel_script_hash =
  #"58585858585858585858585858585858585858585858585858585858"

const deployer = #"66666666666666666666666666666666666666666666666666666666"

const trusting_period = 1_000_000_000

const active_timestamp = 1_500_000_000

fn subject_token() -> AuthToken {
  AuthToken {
    policy_id: client_policy,
    name: generate_token_name(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      client_prefix,
      "0",
    ),
  }
}

fn substitute_token() -> AuthToken {
  AuthToken {
    policy_id: client_policy,
    name: generate_token_name(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      client_prefix,
      "1",
    ),
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
  let final_index =
    math.min(
      max_consensus_state_size - 1,
      list.length(subject.state.consensus_states),
    )

  ClientDatum {
    ..subject,
    state: ClientDatumState {
      client_state: ClientState {
        ..subject.state.client_state,
        frozen_height: zero_height(),
        latest_height: substitute_height,
      },
      consensus_states: [
        Pair(substitute_height, substitute_consensus),
        ..subject.state.consensus_states
      ]
        |> list.slice(from: 0, to: final_index),
      processed_times: [
        Pair(substitute_height, substitute_time),
        ..subject.state.processed_times
      ]
        |> list.slice(from: 0, to: final_index),
      processed_heights: [
        Pair(substitute_height, substitute_processed_height),
        ..subject.state.processed_heights
      ]
        |> list.slice(from: 0, to: final_index),
    },
  }
}

fn commitment_key_bit(key_hash: ByteArray, depth: Int) -> Int {
  let byte_index = 7 - depth / 8
  let bit_in_byte = depth % 8
  bits.shr(builtin.index_bytearray(key_hash, byte_index), bit_in_byte) % 2
}

fn shares_path_above(
  first_hash: ByteArray,
  second_hash: ByteArray,
  depth: Int,
) -> Bool {
  let next_depth = depth + 1
  if next_depth == ibc_state_commitment.merkle_depth_bits {
    True
  } else {
    commitment_key_bit(first_hash, next_depth) == commitment_key_bit(
      second_hash,
      next_depth,
    ) && shares_path_above(first_hash, second_hash, next_depth)
  }
}

fn sparse_subtree_root(
  entries: Pairs<ByteArray, ByteArray>,
  depth: Int,
) -> ByteArray {
  when entries is {
    [] -> ibc_state_commitment.empty_hash
    _ ->
      if depth < 0 {
        expect [Pair(key, value)] = entries
        ibc_state_commitment.leaf_hash(
          builtin.sha2_256(key),
          ibc_state_commitment.value_hash(value),
        )
      } else {
        let left =
          list.filter(
            entries,
            fn(entry) {
              commitment_key_bit(builtin.sha2_256(entry.1st), depth) == 0
            },
          )
        let right =
          list.filter(
            entries,
            fn(entry) {
              commitment_key_bit(builtin.sha2_256(entry.1st), depth) == 1
            },
          )
        ibc_state_commitment.inner_hash(
          sparse_subtree_root(left, depth - 1),
          sparse_subtree_root(right, depth - 1),
        )
      }
  }
}

fn sparse_siblings_go(
  entries: Pairs<ByteArray, ByteArray>,
  target_key: ByteArray,
  target_hash: ByteArray,
  depth: Int,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    let target_bit = commitment_key_bit(target_hash, depth)
    let sibling_entries =
      list.filter(
        entries,
        fn(entry) {
          let entry_hash = builtin.sha2_256(entry.1st)
          entry.1st != target_key && commitment_key_bit(entry_hash, depth) != target_bit && shares_path_above(
            entry_hash,
            target_hash,
            depth,
          )
        },
      )
    [
      sparse_subtree_root(sibling_entries, depth - 1),
      ..sparse_siblings_go(entries, target_key, target_hash, depth + 1)
    ]
  }
}

fn sparse_siblings(
  entries: Pairs<ByteArray, ByteArray>,
  target_key: ByteArray,
) -> List<ByteArray> {
  sparse_siblings_go(entries, target_key, builtin.sha2_256(target_key), 0)
}

fn sparse_root(entries: Pairs<ByteArray, ByteArray>) -> ByteArray {
  sparse_subtree_root(entries, ibc_state_commitment.merkle_depth_bits - 1)
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
  let base_redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(host_reference), host_redeemer),
      Pair(Spend(subject_reference), subject_redeemer),
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
    ],
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
  let subject = frozen_subject()
  let substitute = active_substitute()
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
  let old_root = sparse_root(old_entries)
  let client_state_siblings = sparse_siblings(old_entries, subject_client_key)
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
  expect root_after_client_update == sparse_root(entries_after_client_update)
  let consensus_state_siblings =
    sparse_siblings(entries_after_client_update, subject_new_consensus_key)
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
  expect new_root == sparse_root(final_entries)
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
    spending_client.spend_client.spend(
      host_policy,
      address.Script(recovery_script_hash),
      Some(subject),
      RecoverClient { substitute_token: substitute.token },
      subject_reference,
      transaction,
    ),
    recover_client.recover_client.withdraw(
      host_policy,
      recovery_redeemer(subject, substitute),
      address.Script(recovery_script_hash),
      transaction,
    ),
    host_state_stt.host_state_stt.spend(
      host_policy,
      client_script_hash,
      connection_script_hash,
      channel_script_hash,
      Some(old_host_datum),
      host_update_redeemer,
      host_reference,
      transaction,
    ),
  }
}

test atomic_recovery_all_validators_accept_real_root_transition() {
  run_atomic_recovery(True)
}

test atomic_recovery_host_rejects_wrong_committed_root() fail {
  run_atomic_recovery(False)
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

fn run_recovery_with_history(history_size: Int) -> Bool {
  let subject = subject_with_history(history_size)
  let substitute = substitute_after(history_size)
  run_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

fn recovery_transaction_fixture_with_history(history_size: Int) -> Bool {
  let subject = subject_with_history(history_size)
  let substitute = substitute_after(history_size)
  let transaction =
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      True,
      True,
    )

  and {
    list.length(transaction.inputs) == 2,
    list.length(transaction.reference_inputs) == 1,
    list.length(transaction.outputs) == 2,
    list.length(transaction.withdrawals) == 1,
    list.length(transaction.extra_signatories) == 1,
    list.length(transaction.redeemers) == 3,
  }
}

// These large-history tests are diagnostic cost probes. A passing result only
// means the transition is correct. It does not mean the full three-script
// recovery transaction fits public execution limits. The 150 and 300 entry
// withdrawal-validator probes already exceed the public memory limit alone.
test recovery_capacity_fixture_300_cost() {
  let subject = subject_with_history(max_consensus_state_size)
  let substitute = substitute_after(max_consensus_state_size)
  let recovered = expected_recovered(subject, substitute)

  and {
    list.length(subject.state.consensus_states) == max_consensus_state_size,
    list.length(subject.state.processed_times) == max_consensus_state_size,
    list.length(subject.state.processed_heights) == max_consensus_state_size,
    list.length(recovered.state.consensus_states) == max_consensus_state_size,
    list.length(recovered.state.processed_times) == max_consensus_state_size,
    list.length(recovered.state.processed_heights) == max_consensus_state_size,
  }
}

test recover_state_at_capacity_evicts_only_one_tail() {
  let subject = subject_with_history(max_consensus_state_size)
  let substitute = substitute_after(max_consensus_state_size)
  let recovered = expected_recovered(subject, substitute)

  and {
    client_datum_mod.recover_state(subject, substitute, recovered),
    list.length(recovered.state.consensus_states) == max_consensus_state_size,
    pairs.has_key(recovered.state.consensus_states, height(2)),
    !pairs.has_key(recovered.state.consensus_states, height(1)),
  }
}

test recover_client_validator_history_50_cost() {
  run_recovery_with_history(50)
}

test recovery_transaction_fixture_history_50_cost() {
  recovery_transaction_fixture_with_history(50)
}

test recover_client_validator_history_100_cost() {
  run_recovery_with_history(100)
}

test recovery_transaction_fixture_history_100_cost() {
  recovery_transaction_fixture_with_history(100)
}

test recover_client_validator_history_150_cost() {
  run_recovery_with_history(150)
}

test recovery_transaction_fixture_history_150_cost() {
  recovery_transaction_fixture_with_history(150)
}

test recover_client_validator_history_300_cost() {
  run_recovery_with_history(max_consensus_state_size)
}

test recovery_transaction_fixture_history_300_cost() {
  recovery_transaction_fixture_with_history(max_consensus_state_size)
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
