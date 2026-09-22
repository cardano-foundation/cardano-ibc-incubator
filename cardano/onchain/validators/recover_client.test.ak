use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/interval
use aiken/primitive/bytearray
use cardano/address
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, Withdraw,
}
use host_state_stt
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken, generate_token_name}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckClientHistory, CheckStagedClientHistory, ReclaimTransferWithdrawal,
  RecoverClient, RecoverClientWithdrawal, RecoverClientWithdrawalRedeemer,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer as staged_client
use ibc/client/ics_007_tendermint_client/multitx/types.{
  BurnSessions, CommitCore, Complete, Finalize, SessionDatum, UpdatePlan,
}
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
use minting_tendermint_update_session
use recover_client
use spending_client
use spending_multitx_client
use spending_tendermint_update_session

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

fn reclaim_transfer(obligation: Int) -> Bool {
  let port_policy = #"77777777777777777777777777777777777777777777777777777777"
  let module_policy =
    #"88888888888888888888888888888888888888888888888888888888"
  let port_name = "transfer"
  let module_name = "module"
  let input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"9999999999999999999999999999999999999999999999999999999999999999",
        output_index: 0,
      },
      output: Output {
        address: address.from_script("transfer module"),
        value: from_asset(port_policy, port_name, 1)
          |> assets.add(module_policy, module_name, 1),
        datum: InlineDatum(
          TransferModuleDatum {
            escrow_shard_registry_root: empty_escrow_shard_registry_root,
            outstanding_voucher_obligation: obligation,
          },
        ),
        reference_script: None,
      },
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      mint: from_asset(port_policy, port_name, -1)
        |> assets.add(module_policy, module_name, -1),
    }
  recover_client.recover_client.withdraw(
    host_policy,
    ReclaimTransferWithdrawal {
      port_unit: bytearray.concat(port_policy, port_name),
      module_unit: bytearray.concat(module_policy, module_name),
      escrow_policy: "unused escrow policy",
    },
    address.Script(recovery_script_hash),
    transaction,
  )
}

test reclaim_transfer_accepts_zero_voucher_obligation() {
  reclaim_transfer(0)
}

test reclaim_transfer_rejects_outstanding_voucher_obligation() fail {
  reclaim_transfer(1)
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
    history_root: #"0000000000000000000000000000000000000000000000000000000000000000",
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
    history_root: consensus_history.insert(
      subject.history_root,
      consensus_history.from_client(subject),
      list.repeat(ibc_state_commitment.empty_hash, 64),
    ),
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
    RecoverClient {
      substitute_token: substitute.token,
      history_siblings: list.repeat(ibc_state_commitment.empty_hash, 64),
    }
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
  run_atomic_recovery_for_protocol(
    correct_output_root,
    actual_client_policy,
    verify_host_state,
    False,
  )
}

fn staged_recovery_transaction(
  tx: Transaction,
  substitute: AuthToken,
) -> Transaction {
  let staged_redeemer: Redeemer =
    staged_client.RecoverClient {
      substitute_token: substitute,
      history_siblings: list.repeat(
        #"0000000000000000000000000000000000000000000000000000000000000000",
        64,
      ),
    }
  Transaction {
    ..tx,
    redeemers: list.map(
      tx.redeemers,
      fn(pair) {
        if pair.1st == Spend(subject_reference) {
          Pair(pair.1st, staged_redeemer)
        } else {
          pair
        }
      },
    ),
  }
}

fn run_atomic_recovery_for_protocol(
  correct_output_root: Bool,
  actual_client_policy: ByteArray,
  verify_host_state: Bool,
  staged: Bool,
) -> Bool {
  run_atomic_recovery_with_validation(
    correct_output_root,
    actual_client_policy,
    verify_host_state,
    staged,
    True,
  )
}

// Serializing the complete context keeps every fixture field in both halves
// of the budget pair. These are context bytes, not signed transaction bytes.
fn atomic_fixture_is_constructed(tx: Transaction) -> Bool {
  bytearray.length(cbor.serialise(tx)) > 0
}

fn run_atomic_recovery_with_validation(
  correct_output_root: Bool,
  actual_client_policy: ByteArray,
  verify_host_state: Bool,
  staged: Bool,
  verify_validators: Bool,
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

  let transaction =
    if staged {
      staged_recovery_transaction(transaction, substitute.token)
    } else {
      transaction
    }
  expect atomic_fixture_is_constructed(transaction)
  if !verify_validators {
    True
  } else {
    expect
      if staged {
        spending_multitx_client.spend_multitx_client.spend(
          host_policy,
          "unused session mint policy",
          address.Script(recovery_script_hash),
          Some(subject),
          staged_client.RecoverClient {
            substitute_token: substitute.token,
            history_siblings: list.repeat(
              #"0000000000000000000000000000000000000000000000000000000000000000",
              64,
            ),
          },
          subject_reference,
          transaction,
        )
      } else {
        spending_client.spend_client.spend(
          host_policy,
          address.Script(recovery_script_hash),
          Some(subject),
          RecoverClient {
            substitute_token: substitute.token,
            history_siblings: list.repeat(
              #"0000000000000000000000000000000000000000000000000000000000000000",
              64,
            ),
          },
          subject_reference,
          transaction,
        )
      }
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
        "unused connection minting policy",
        "unused channel minting policy",
        Some(old_host_datum),
        host_update_redeemer,
        host_reference,
        transaction,
      )
    } else {
      True
    }
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

test staged_atomic_recovery_all_validators_accept_real_root_transition() {
  run_atomic_recovery_for_protocol(True, client_policy, True, True)
}

test staged_atomic_recovery_fixture_setup_baseline() {
  run_atomic_recovery_with_validation(True, client_policy, True, True, False)
}

const evidence_session_policy =
  #"abababababababababababababababababababababababababababab"

const evidence_session_script =
  #"acacacacacacacacacacacacacacacacacacacacacacacacacacacac"

const evidence_validator_root =
  #"adadadadadadadadadadadadadadadadadadadadadadadadadadadadadadadad"

fn freeze_receipt(
  token_name: ByteArray,
  app_hash: ByteArray,
  subject: ClientDatum,
) -> SessionDatum {
  expect [Pair(trusted_height, trusted_consensus_state)] =
    subject.state.consensus_states
  let header =
    TmHeader {
      ..tm_header_mod.null_tm_header(),
      version: Consensus { block: block_protocol, app: 0 },
      chain_id: subject.state.client_state.chain_id,
      height: trusted_height.revision_height + 1,
      time: active_timestamp + 100_000_000,
      validators_hash: evidence_validator_root,
      next_validators_hash: evidence_validator_root,
      app_hash,
    }
  SessionDatum {
    session_token: AuthToken {
      policy_id: evidence_session_policy,
      name: token_name,
    },
    owner: deployer,
    plan: UpdatePlan {
      client_token: subject.token,
      trusted_height,
      trusted_consensus_state,
      trust_level: subject.state.client_state.trust_level,
      trusting_period: subject.state.client_state.trusting_period,
      max_clock_drift: subject.state.client_state.max_clock_drift,
      header,
      commit: CommitCore {
        height: header.height,
        round: 0,
        block_id: BlockID {
          hash: tm_header_mod.hash(header),
          part_set_header: PartSetHeader {
            total: 1,
            hash: evidence_validator_root,
          },
        },
      },
      target_validator_count: 1,
      trusted_validator_count: 0,
    },
    phase: Complete {
      target_root: evidence_validator_root,
      target_total_power: 10,
      target_signed_power: 10,
      trusted_root: None,
      trusted_total_power: 0,
      trusted_signed_power: 0,
    },
  }
}

fn freeze_session_input(receipt: SessionDatum, tx_hash: ByteArray) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: tx_hash,
      output_index: 0,
    },
    output: Output {
      address: address.from_script(evidence_session_script),
      value: from_asset(evidence_session_policy, receipt.session_token.name, 1),
      datum: InlineDatum(receipt),
      reference_script: None,
    },
  }
}

fn run_atomic_staged_freeze(correct_root: Bool, verify_validators: Bool) -> Bool {
  let original_subject =
    datum(subject_token(), height(10), active_timestamp, zero_height())
  let subject =
    ClientDatum {
      ..original_subject,
      state: ClientDatumState {
        ..original_subject.state,
        consensus_states: [
          Pair(height(10), consensus(active_timestamp, evidence_validator_root)),
        ],
      },
    }
  let frozen =
    ClientDatum {
      ..subject,
      state: ClientDatumState {
        ..subject.state,
        client_state: ClientState {
          ..subject.state.client_state,
          frozen_height: Height { revision_number: 0, revision_height: 1 },
        },
      },
    }
  let client_key = client_keys.full_client_state_path("07-tendermint-0")
  let consensus_key =
    client_keys.full_client_consensus_state_path("07-tendermint-0", "10")
  expect [Pair(_, trusted)] = subject.state.consensus_states
  let old_entries =
    [
      Pair(client_key, cbor.serialise(subject.state.client_state)),
      Pair(consensus_key, cbor.serialise(trusted)),
    ]
  let old_root = sparse_tree.root(old_entries)
  let client_state_siblings = sparse_tree.siblings(old_entries, client_key)
  let new_root =
    ibc_state_commitment.apply_update(
      old_root,
      client_key,
      cbor.serialise(subject.state.client_state),
      cbor.serialise(frozen.state.client_state),
      client_state_siblings,
    )
  expect
    new_root == sparse_tree.root(
      [
        Pair(client_key, cbor.serialise(frozen.state.client_state)),
        Pair(consensus_key, cbor.serialise(trusted)),
      ],
    )
  let old_host = host_datum_at(old_root, 0)
  let new_host =
    host_datum_at(
      if correct_root {
        new_root
      } else {
        old_root
      },
      1,
    )
  let first =
    freeze_receipt(
      evidence_validator_root,
      #"aeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeae",
      subject,
    )
  let second =
    freeze_receipt(
      #"afafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafaf",
      evidence_validator_root,
      subject,
    )
  let first_input =
    freeze_session_input(
      first,
      #"babababababababababababababababababababababababababababababababa",
    )
  let second_input =
    freeze_session_input(
      second,
      #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )
  let host_redeemer =
    host_state_redeemer.UpdateClient {
      client_state_siblings,
      consensus_state_siblings: [],
    }

  let client_redeemer =
    staged_client.FinalizeMisbehaviour {
      history_witnesses: [],
      session_token_1: first.session_token,
      session_token_2: second.session_token,
    }
  let mint_redeemer =
    BurnSessions {
      token_names: [first.session_token.name, second.session_token.name],
    }
  let host_redeemer_data: Redeemer = host_redeemer
  let client_redeemer_data: Redeemer = client_redeemer
  let mint_redeemer_data: Redeemer = mint_redeemer
  let history_redeemer =
    CheckStagedClientHistory { subject_token: subject.token }
  let history_data: Redeemer = history_redeemer
  let finalization_data: Redeemer = Finalize
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [
        Input {
          output_reference: host_reference,
          output: host_output_with_datum(old_host),
        },
        Input {
          output_reference: subject_reference,
          output: client_output(subject, client_script_hash),
        },
        first_input,
        second_input,
      ],
      outputs: [
        host_output_with_datum(new_host),
        client_output(frozen, client_script_hash),
      ],
      validity_range: interval.between(1900, 2000),
      extra_signatories: [deployer],
      mint: from_asset(evidence_session_policy, first.session_token.name, -1)
        |> assets.add(evidence_session_policy, second.session_token.name, -1),
      withdrawals: [Pair(address.Script(recovery_script_hash), 0)],
      redeemers: [
        Pair(Withdraw(address.Script(recovery_script_hash)), history_data),
        Pair(Spend(host_reference), host_redeemer_data),
        Pair(Spend(subject_reference), client_redeemer_data),
        Pair(Spend(first_input.output_reference), finalization_data),
        Pair(Spend(second_input.output_reference), finalization_data),
        Pair(Mint(evidence_session_policy), mint_redeemer_data),
      ],
    }
  expect atomic_fixture_is_constructed(tx)
  if !verify_validators {
    True
  } else {
    and {
      recover_client.recover_client.withdraw(
        host_policy,
        history_redeemer,
        address.Script(recovery_script_hash),
        tx,
      ),
      spending_multitx_client.spend_multitx_client.spend(
        host_policy,
        evidence_session_policy,
        address.Script(recovery_script_hash),
        Some(subject),
        client_redeemer,
        subject_reference,
        tx,
      ),
      spending_tendermint_update_session.spend_tendermint_update_session.spend(
        host_policy,
        Some(first),
        Finalize,
        first_input.output_reference,
        tx,
      ),
      spending_tendermint_update_session.spend_tendermint_update_session.spend(
        host_policy,
        Some(second),
        Finalize,
        second_input.output_reference,
        tx,
      ),
      minting_tendermint_update_session.mint_tendermint_update_session.mint(
        evidence_session_script,
        mint_redeemer,
        evidence_session_policy,
        tx,
      ),
      host_state_stt.host_state_stt.spend(
        host_policy,
        client_script_hash,
        connection_script_hash,
        channel_script_hash,
        client_policy,
        "unused connection minting policy",
        "unused channel minting policy",
        Some(old_host),
        host_redeemer,
        host_reference,
        tx,
      ),
    }
  }
}

test staged_atomic_freeze_fixture_setup_baseline() {
  run_atomic_staged_freeze(True, False)
}

test staged_atomic_freeze_all_validators_accept_real_root_transition() {
  run_atomic_staged_freeze(True, True)
}

test staged_atomic_freeze_host_rejects_wrong_committed_root() fail {
  run_atomic_staged_freeze(False, True)
}

test staged_atomic_recovery_host_rejects_wrong_committed_root() fail {
  run_atomic_recovery_for_protocol(False, client_policy, True, True)
}

test staged_atomic_recovery_host_rejects_counterfeit_client_policy() fail {
  run_atomic_recovery_for_protocol(True, other_client_policy, True, True)
}

fn run_staged_recovery(
  subject: ClientDatum,
  substitute: ClientDatum,
  recovered: ClientDatum,
  substitute_script_hash: ByteArray,
  signers: List<ByteArray>,
) -> Bool {
  let tx =
    recovery_transaction(
      subject,
      substitute,
      recovered,
      substitute_script_hash,
      signers,
      True,
      True,
    )
      |> staged_recovery_transaction(substitute.token)
  and {
    spending_multitx_client.spend_multitx_client.spend(
      host_policy,
      "unused session mint policy",
      address.Script(recovery_script_hash),
      Some(subject),
      staged_client.RecoverClient {
        substitute_token: substitute.token,
        history_siblings: list.repeat(
          #"0000000000000000000000000000000000000000000000000000000000000000",
          64,
        ),
      },
      subject_reference,
      tx,
    ),
    recover_client.recover_client.withdraw(
      host_policy,
      recovery_redeemer(subject, substitute),
      address.Script(recovery_script_hash),
      tx,
    ),
  }
}

test staged_recovery_accepts_expired_subject() {
  let subject = expired_subject()
  let substitute = active_substitute()
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_accepts_frozen_subject() {
  let subject = frozen_subject()
  let substitute = active_substitute()
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_missing_authority() fail {
  let subject = frozen_subject()
  let substitute = active_substitute()
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [],
  )
}

test staged_recovery_rejects_active_subject() fail {
  let subject =
    datum(subject_token(), height(10), active_timestamp, zero_height())
  let substitute = active_substitute()
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_frozen_substitute() fail {
  let subject = frozen_subject()
  let substitute =
    datum(substitute_token(), height(20), active_timestamp, height(7))
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_expired_substitute() fail {
  let subject = frozen_subject()
  let substitute = datum(substitute_token(), height(20), 0, zero_height())
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_older_substitute() fail {
  let subject = frozen_subject()
  let substitute =
    datum(substitute_token(), height(9), active_timestamp, zero_height())
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_another_client_address() fail {
  let subject = frozen_subject()
  let substitute = active_substitute()
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    other_client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_changed_immutable_parameters() fail {
  let subject = frozen_subject()
  let original_substitute = active_substitute()
  let substitute =
    ClientDatum {
      ..original_substitute,
      state: ClientDatumState {
        ..original_substitute.state,
        client_state: ClientState {
          ..original_substitute.state.client_state,
          chain_id: "other-1",
        },
      },
    }
  run_staged_recovery(
    subject,
    substitute,
    expected_recovered(subject, substitute),
    client_script_hash,
    [deployer],
  )
}

test staged_recovery_rejects_missing_authority_withdrawal() fail {
  let subject = frozen_subject()
  let substitute = active_substitute()
  let tx =
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      False,
      False,
    )
      |> staged_recovery_transaction(substitute.token)
  spending_multitx_client.spend_multitx_client.spend(
    host_policy,
    "unused session mint policy",
    address.Script(recovery_script_hash),
    Some(subject),
    staged_client.RecoverClient {
      substitute_token: substitute.token,
      history_siblings: list.repeat(
        #"0000000000000000000000000000000000000000000000000000000000000000",
        64,
      ),
    },
    subject_reference,
    tx,
  )
}

test staged_recovery_rejects_another_substitute_in_spend() fail {
  let subject = frozen_subject()
  let substitute = active_substitute()
  let tx =
    recovery_transaction(
      subject,
      substitute,
      expected_recovered(subject, substitute),
      client_script_hash,
      [deployer],
      True,
      True,
    )
      |> staged_recovery_transaction(subject.token)
  recover_client.recover_client.withdraw(
    host_policy,
    recovery_redeemer(subject, substitute),
    address.Script(recovery_script_hash),
    tx,
  )
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
    history_root: #"0000000000000000000000000000000000000000000000000000000000000000",
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
  // Earlier records are committed off-chain and are not recovery inputs.
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
    list.length(transaction.outputs) == 2,
    list.length(transaction.redeemers) == 3,
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

fn state_value_recovery(output_ada: Int, output_reserve: Int) -> Bool {
  let subject = expired_subject()
  let substitute = active_substitute()
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
  expect [host_input, subject_input] = transaction.inputs
  expect [subject_output, host_output] = transaction.outputs
  let subject_input =
    Input {
      ..subject_input,
      output: Output {
        ..subject_input.output,
        value: subject_input.output.value
          |> assets.merge(assets.from_lovelace(8_000_000))
          |> assets.add("reserve policy", "reserve", 7),
      },
    }
  let subject_output =
    Output {
      ..subject_output,
      value: subject_output.value
        |> assets.merge(assets.from_lovelace(output_ada))
        |> assets.add("reserve policy", "reserve", output_reserve),
    }
  let transaction =
    Transaction {
      ..transaction,
      inputs: [host_input, subject_input],
      outputs: [subject_output, host_output],
    }
  and {
    spending_client.spend_client.spend(
      host_policy,
      address.Script(recovery_script_hash),
      Some(subject),
      RecoverClient {
        substitute_token: substitute.token,
        history_siblings: list.repeat(
          #"0000000000000000000000000000000000000000000000000000000000000000",
          64,
        ),
      },
      subject_reference,
      transaction,
    ),
    recover_client.recover_client.withdraw(
      host_policy,
      recovery_redeemer(subject, substitute),
      address.Script(recovery_script_hash),
      transaction,
    ),
  }
}

test state_value_recovery_preserves_existing_unrelated_assets() {
  state_value_recovery(8_000_000, 7)
}

test state_value_recovery_allows_ada_top_up() {
  state_value_recovery(10_000_000, 7)
}

test state_value_recovery_rejects_ada_sweep() fail {
  state_value_recovery(2_000_000, 7)
}

test state_value_recovery_rejects_unrelated_asset_sweep() fail {
  state_value_recovery(8_000_000, 0)
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

test regression_client_recovery_accepts_expired_subject() {
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

test regression_client_recovery_accepts_frozen_subject() {
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

test regression_client_recovery_rejects_missing_authority() fail {
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
    RecoverClient {
      substitute_token: substitute.token,
      history_siblings: list.repeat(ibc_state_commitment.empty_hash, 64),
    },
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
    RecoverClient {
      substitute_token: substitute.token,
      history_siblings: list.repeat(ibc_state_commitment.empty_hash, 64),
    },
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

fn spend_with_forged_recovery_support(support: Redeemer) -> Bool {
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
  let credential = address.Script(recovery_script_hash)
  let raw: Redeemer = support
  spending_client.spend_client.spend(
    host_policy,
    credential,
    Some(subject),
    RecoverClient {
      substitute_token: substitute.token,
      history_siblings: list.repeat(ibc_state_commitment.empty_hash, 64),
    },
    subject_reference,
    Transaction {
      ..tx,
      redeemers: [Pair(Withdraw(credential), raw), ..tx.redeemers],
    },
  )
}

test recovery_spend_rejects_update_support_branch() fail {
  spend_with_forged_recovery_support(
    CheckClientHistory { subject_token: subject_token() },
  )
}

test recovery_spend_rejects_other_subject_support() fail {
  spend_with_forged_recovery_support(
    RecoverClientWithdrawal {
      subject_token: substitute_token(),
      substitute_token: substitute_token(),
    },
  )
}

test recovery_spend_rejects_other_substitute_support() fail {
  spend_with_forged_recovery_support(
    RecoverClientWithdrawal {
      subject_token: subject_token(),
      substitute_token: subject_token(),
    },
  )
}

test recovery_support_rejects_history_root_copy_from_substitute() fail {
  let subject = expired_subject()
  let substitute = active_substitute()
  let recovered =
    ClientDatum {
      ..expected_recovered(subject, substitute),
      history_root: substitute.history_root,
    }
  run_recovery(subject, substitute, recovered, client_script_hash, [deployer])
}

test recovery_retains_nonempty_subject_history_not_substitute_history() {
  let before = datum(subject_token(), height(9), 0, zero_height())
  let record = consensus_history.from_client(before)
  let entries =
    [
      Pair(
        consensus_history.key(record.client_token, record.height),
        consensus_history.value(record),
      ),
    ]
  let subject =
    ClientDatum { ..expired_subject(), history_root: sparse_tree.root(entries) }
  let substitute = active_substitute()
  let old_tip = consensus_history.from_client(subject)
  let siblings =
    sparse_tree.siblings(
      entries,
      consensus_history.key(old_tip.client_token, old_tip.height),
    )
  let output =
    ClientDatum {
      ..expected_recovered(expired_subject(), substitute),
      history_root: consensus_history.insert(
        subject.history_root,
        old_tip,
        siblings,
      ),
    }
  let tx =
    recovery_transaction(
      subject,
      substitute,
      output,
      client_script_hash,
      [deployer],
      True,
      True,
    )
  let redeemer =
    RecoverClient {
      substitute_token: substitute.token,
      history_siblings: siblings,
    }
  let raw: Redeemer = redeemer
  let supported =
    Transaction {
      ..tx,
      redeemers: list.map(
        tx.redeemers,
        fn(pair) {
          if pair.1st == Spend(subject_reference) {
            Pair(pair.1st, raw)
          } else {
            pair
          }
        },
      ),
    }
  and {
    spending_client.spend_client.spend(
      host_policy,
      address.Script(recovery_script_hash),
      Some(subject),
      redeemer,
      subject_reference,
      supported,
    ),
    recover_client.recover_client.withdraw(
      host_policy,
      recovery_redeemer(subject, substitute),
      address.Script(recovery_script_hash),
      supported,
    ),
    output.history_root == sparse_tree.root(
      [
        Pair(
          consensus_history.key(old_tip.client_token, old_tip.height),
          consensus_history.value(old_tip),
        ),
        ..entries
      ],
    ),
    output.history_root != substitute.history_root,
  }
}

test spend_client_rejects_malformed_recovery_withdrawal() fail {
  spend_with_forged_recovery_support(Void)
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
    RecoverClient {
      substitute_token: fake_substitute.token,
      history_siblings: list.repeat(ibc_state_commitment.empty_hash, 64),
    }
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
    RecoverClient {
      substitute_token: substitute.token,
      history_siblings: list.repeat(ibc_state_commitment.empty_hash, 64),
    },
    subject_reference,
    tx,
  )
}
