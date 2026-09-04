use aiken/cbor
use aiken/collection/list
use aiken/math
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset, zero}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Redeemer, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  SpendClientRedeemer, UpdateClient as UpdateTendermintClient,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator} as tm_validator_mod
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/multitx/merkle_accumulator
use ibc/client/ics_007_tendermint_client/multitx/rfc6962_membership
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  AdjacentTarget, Cancel, CommitCore, Complete, Finalize, NonAdjacentTarget,
  SessionDatum, TargetEntry, TrustedMembership, UpdatePlan, ValidatorOrderKey,
  VerifyTarget, VerifyTrusted,
}
use ibc/client/ics_007_tendermint_client/test_fixtures/tendermint_update_capacity.{
  adjacent_all_signed_spend_client_redeemer_cbor,
  adjacent_all_signed_trusted_app_hash, adjacent_all_signed_trusted_timestamp,
  adjacent_all_signed_trusted_validator_set_hash,
  non_adjacent_mixed_spend_client_redeemer_cbor,
  non_adjacent_mixed_trusted_app_hash, non_adjacent_mixed_trusted_timestamp,
  non_adjacent_mixed_trusted_validator_set_hash,
}
use ibc/client/ics_007_tendermint_client/test_fixtures/tendermint_update_depth_eight as depth_eight
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{UpdateClient}
use spending_tendermint_update_session

const validator_root =
  #"1111111111111111111111111111111111111111111111111111111111111111"

const session_script_hash =
  #"22222222222222222222222222222222222222222222222222222222"

const owner = #"33333333333333333333333333333333333333333333333333333333"

fn output_ref(byte: ByteArray, index: Int) -> OutputReference {
  OutputReference { transaction_id: byte, output_index: index }
}

fn session_auth_token() -> AuthToken {
  AuthToken {
    policy_id: #"44444444444444444444444444444444444444444444444444444444",
    name: #"5555555555555555555555555555555555555555555555555555555555555555",
  }
}

fn client_auth_token() -> AuthToken {
  AuthToken {
    policy_id: #"66666666666666666666666666666666666666666666666666666666",
    name: "08-tendermint-0",
  }
}

fn plan() -> UpdatePlan {
  let header =
    TmHeader {
      ..tm_header_mod.null_tm_header(),
      version: Consensus { block: block_protocol, app: 0 },
      chain_id: "chain-0",
      height: 11,
      time: 1_500_000_000,
      validators_hash: validator_root,
      next_validators_hash: validator_root,
      app_hash: #"7777777777777777777777777777777777777777777777777777777777777777",
    }
  UpdatePlan {
    client_token: client_auth_token(),
    trusted_height: Height { revision_number: 0, revision_height: 10 },
    trusted_consensus_state: ConsensusState {
      timestamp: 1_000_000_000,
      next_validators_hash: validator_root,
      root: merkle.new_merkle_root(#"88"),
    },
    trust_level: unchecked_rational.new(1, 3),
    trusting_period: 10_000_000_000,
    max_clock_drift: 1_000_000_000,
    header,
    commit: CommitCore {
      height: header.height,
      round: 0,
      block_id: BlockID {
        hash: tm_header_mod.hash(header),
        part_set_header: PartSetHeader { total: 1, hash: validator_root },
      },
    },
    // Keep the first batch non-terminal so this transaction test need not
    // include a cryptographic signature fixture.
    target_validator_count: 2,
    trusted_validator_count: 0,
  }
}

fn datum() -> SessionDatum {
  session.initial_datum(session_auth_token(), owner, plan())
}

fn entry() -> TargetEntry {
  TargetEntry {
    target_validator: Validator {
      address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
      voting_power: 1,
      proposer_priority: 0,
    },
    commit_sig: CommitSig {
      block_id_flag: 1,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    },
    trusted_membership: None,
  }
}

fn session_input(input_datum: SessionDatum) -> Input {
  Input {
    output_reference: output_ref(
      #"9999999999999999999999999999999999999999999999999999999999999999",
      0,
    ),
    output: Output {
      address: from_script(session_script_hash),
      value: from_asset(
        input_datum.session_token.policy_id,
        input_datum.session_token.name,
        1,
      ),
      datum: InlineDatum(input_datum),
      reference_script: None,
    },
  }
}

fn continuation(input: Input, output_datum: SessionDatum) -> Output {
  Output { ..input.output, datum: InlineDatum(output_datum) }
}

fn take_target_entries(
  validators: List<Validator>,
  signatures: List<CommitSig>,
  remaining: Int,
) -> List<TargetEntry> {
  if remaining <= 0 {
    []
  } else {
    expect [target_validator, ..rest_validators] = validators
    expect [commit_sig, ..rest_signatures] = signatures
    [
      TargetEntry { target_validator, commit_sig, trusted_membership: None },
      ..take_target_entries(rest_validators, rest_signatures, remaining - 1)
    ]
  }
}

fn real_adjacent_batch() -> (SessionDatum, List<TargetEntry>) {
  expect Some(data) =
    cbor.deserialise(adjacent_all_signed_spend_client_redeemer_cbor)
  expect redeemer: SpendClientRedeemer = data
  expect UpdateTendermintClient{msg: HeaderCase(header)} = redeemer
  let target_validators = header.validator_set.validators
  let signed_header = header.signed_header
  let tm_header = signed_header.header
  let commit = signed_header.commit
  let fixture_plan =
    UpdatePlan {
      client_token: client_auth_token(),
      trusted_height: header.trusted_height,
      trusted_consensus_state: ConsensusState {
        timestamp: adjacent_all_signed_trusted_timestamp,
        next_validators_hash: adjacent_all_signed_trusted_validator_set_hash,
        root: merkle.new_merkle_root(adjacent_all_signed_trusted_app_hash),
      },
      trust_level: unchecked_rational.new(1, 3),
      trusting_period: 1_209_600_000_000_000,
      max_clock_drift: 10_000_000_000,
      header: tm_header,
      commit: CommitCore {
        height: commit.height,
        round: commit.round,
        block_id: commit.block_id,
      },
      target_validator_count: list.length(target_validators),
      trusted_validator_count: 0,
    }
  (
    session.initial_datum(session_auth_token(), owner, fixture_plan),
    take_target_entries(target_validators, commit.signatures, 6),
  )
}

fn accumulate_expected_entries(
  entries: List<TargetEntry>,
  accumulator: merkle_accumulator.MerkleAccumulator,
  total_power: Int,
  signed_power: Int,
  last_target: Option<ValidatorOrderKey>,
) -> (merkle_accumulator.MerkleAccumulator, Int, Int, Option<ValidatorOrderKey>) {
  when entries is {
    [] -> (accumulator, total_power, signed_power, last_target)
    [entry, ..rest] -> {
      let target = entry.target_validator
      accumulate_expected_entries(
        rest,
        merkle_accumulator.append(accumulator, tm_validator_mod.bytes(target)),
        total_power + target.voting_power,
        if entry.commit_sig.block_id_flag == block_id_flag_commit {
          signed_power + target.voting_power
        } else {
          signed_power
        },
        Some(
          ValidatorOrderKey {
            voting_power: target.voting_power,
            address: target.address,
          },
        ),
      )
    }
  }
}

fn expected_adjacent_continuation(
  input_datum: SessionDatum,
  entries: List<TargetEntry>,
) -> SessionDatum {
  let (target_accumulator, target_total_power, target_signed_power, last_target) =
    accumulate_expected_entries(entries, merkle_accumulator.empty(), 0, 0, None)
  SessionDatum {
    ..input_datum,
    phase: AdjacentTarget {
      target_accumulator,
      target_total_power,
      target_signed_power,
      last_target,
    },
  }
}

test real_injective_six_validator_fixture_setup_baseline() {
  let (input_datum, entries) = real_adjacent_batch()
  let expected = expected_adjacent_continuation(input_datum, entries)
  expect AdjacentTarget { target_accumulator, .. } = expected.phase
  target_accumulator.count == 6
}

test advances_real_injective_six_validator_target_batch() {
  let (input_datum, entries) = real_adjacent_batch()
  let input = session_input(input_datum)
  let redeemer = VerifyTarget { entries }
  // Build the expected off-chain continuation without verifying signatures a
  // second time; the spending validator below performs the measured checks.
  let expected = expected_adjacent_continuation(input_datum, entries)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [owner],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

fn validator_subtree_root(validators: List<Validator>) -> ByteArray {
  merkle_accumulator.append_all(
    merkle_accumulator.empty(),
    list.map(validators, tm_validator_mod.bytes),
  )
    |> merkle_accumulator.root
}

fn validator_audit_path(
  validators: List<Validator>,
  index: Int,
) -> List<ByteArray> {
  let total = list.length(validators)
  expect total > 0 && index >= 0 && index < total
  if total == 1 {
    []
  } else {
    let split = rfc6962_membership.split_point(total)
    let (left, right) = list.span(validators, split)
    if index < split {
      [validator_subtree_root(right), ..validator_audit_path(left, index)]
    } else {
      [
        validator_subtree_root(left),
        ..validator_audit_path(right, index - split)
      ]
    }
  }
}

fn find_trusted_validator(
  validators: List<Validator>,
  pubkey: ByteArray,
  index: Int,
) -> (Int, Validator) {
  when validators is {
    [] -> fail @"Target validator is absent from trusted fixture"
    [trusted_validator, ..rest] ->
      if trusted_validator.pubkey == pubkey {
        (index, trusted_validator)
      } else {
        find_trusted_validator(rest, pubkey, index + 1)
      }
  }
}

fn take_target_entries_with_membership(
  validators: List<Validator>,
  signatures: List<CommitSig>,
  trusted_validators: List<Validator>,
  remaining: Int,
) -> List<TargetEntry> {
  if remaining <= 0 {
    []
  } else {
    expect [target_validator, ..rest_validators] = validators
    expect [commit_sig, ..rest_signatures] = signatures
    let trusted_membership =
      if commit_sig.block_id_flag == block_id_flag_commit {
        let (index, trusted_validator) =
          find_trusted_validator(trusted_validators, target_validator.pubkey, 0)
        Some(
          TrustedMembership {
            index,
            trusted_validator,
            audit_path: validator_audit_path(trusted_validators, index),
          },
        )
      } else {
        None
      }
    [
      TargetEntry { target_validator, commit_sig, trusted_membership },
      ..take_target_entries_with_membership(
        rest_validators,
        rest_signatures,
        trusted_validators,
        remaining - 1,
      )
    ]
  }
}

fn target_entries_with_membership(
  validators: List<Validator>,
  signatures: List<CommitSig>,
  trusted_validators: List<Validator>,
  start: Int,
  count: Int,
) -> List<TargetEntry> {
  let (_, remaining_validators) = list.span(validators, start)
  let (_, remaining_signatures) = list.span(signatures, start)
  take_target_entries_with_membership(
    remaining_validators,
    remaining_signatures,
    trusted_validators,
    count,
  )
}

fn total_voting_power(validators: List<Validator>) -> Int {
  list.foldl(validators, 0, fn(tm_val, total) { total + tm_val.voting_power })
}

fn accumulate_expected_non_adjacent_entries(
  entries: List<TargetEntry>,
  accumulator: merkle_accumulator.MerkleAccumulator,
  total_power: Int,
  signed_power: Int,
  trusted_signed_power: Int,
  used_trusted_indices: Int,
  last_target: Option<ValidatorOrderKey>,
) -> (
  merkle_accumulator.MerkleAccumulator,
  Int,
  Int,
  Int,
  Int,
  Option<ValidatorOrderKey>,
) {
  when entries is {
    [] ->
      (
        accumulator,
        total_power,
        signed_power,
        trusted_signed_power,
        used_trusted_indices,
        last_target,
      )
    [entry, ..rest] -> {
      let target = entry.target_validator
      let is_commit = entry.commit_sig.block_id_flag == block_id_flag_commit
      let (next_trusted_power, next_used_indices) =
        when entry.trusted_membership is {
          None -> (trusted_signed_power, used_trusted_indices)
          Some(membership) ->
            (
              trusted_signed_power + membership.trusted_validator.voting_power,
              used_trusted_indices + math.pow2(membership.index),
            )
        }
      accumulate_expected_non_adjacent_entries(
        rest,
        merkle_accumulator.append(accumulator, tm_validator_mod.bytes(target)),
        total_power + target.voting_power,
        if is_commit {
          signed_power + target.voting_power
        } else {
          signed_power
        },
        next_trusted_power,
        next_used_indices,
        Some(
          ValidatorOrderKey {
            voting_power: target.voting_power,
            address: target.address,
          },
        ),
      )
    }
  }
}

fn real_non_adjacent_batch() -> (SessionDatum, List<TargetEntry>) {
  expect Some(data) =
    cbor.deserialise(non_adjacent_mixed_spend_client_redeemer_cbor)
  expect redeemer: SpendClientRedeemer = data
  expect UpdateTendermintClient{msg: HeaderCase(header)} = redeemer
  let target_validators = header.validator_set.validators
  let trusted_validators = header.trusted_validators.validators
  let signed_header = header.signed_header
  let tm_header = signed_header.header
  let commit = signed_header.commit
  let trusted_accumulator =
    merkle_accumulator.append_all(
      merkle_accumulator.empty(),
      list.map(trusted_validators, tm_validator_mod.bytes),
    )
  let trusted_root = merkle_accumulator.root(trusted_accumulator)
  expect trusted_root == non_adjacent_mixed_trusted_validator_set_hash
  let fixture_plan =
    UpdatePlan {
      client_token: client_auth_token(),
      trusted_height: header.trusted_height,
      trusted_consensus_state: ConsensusState {
        timestamp: non_adjacent_mixed_trusted_timestamp,
        next_validators_hash: non_adjacent_mixed_trusted_validator_set_hash,
        root: merkle.new_merkle_root(non_adjacent_mixed_trusted_app_hash),
      },
      trust_level: unchecked_rational.new(1, 3),
      trusting_period: 1_209_600_000_000_000,
      max_clock_drift: 10_000_000_000,
      header: tm_header,
      commit: CommitCore {
        height: commit.height,
        round: commit.round,
        block_id: commit.block_id,
      },
      target_validator_count: list.length(target_validators),
      trusted_validator_count: list.length(trusted_validators),
    }
  let first_batch =
    target_entries_with_membership(
      target_validators,
      commit.signatures,
      trusted_validators,
      0,
      6,
    )
  let second_batch =
    target_entries_with_membership(
      target_validators,
      commit.signatures,
      trusted_validators,
      6,
      6,
    )
  let (
    target_accumulator,
    target_total_power,
    target_signed_power,
    trusted_signed_power,
    used_trusted_indices,
    last_target,
  ) =
    accumulate_expected_non_adjacent_entries(
      first_batch,
      merkle_accumulator.empty(),
      0,
      0,
      0,
      0,
      None,
    )
  (
    SessionDatum {
      session_token: session_auth_token(),
      owner,
      plan: fixture_plan,
      phase: NonAdjacentTarget {
        trusted_root,
        trusted_total_power: total_voting_power(trusted_validators),
        target_accumulator,
        target_total_power,
        target_signed_power,
        trusted_signed_power,
        used_trusted_indices,
        last_target,
      },
    },
    second_batch,
  )
}

fn expected_non_adjacent_continuation(
  input_datum: SessionDatum,
  entries: List<TargetEntry>,
) -> SessionDatum {
  expect NonAdjacentTarget {
    trusted_root,
    trusted_total_power,
    target_accumulator,
    target_total_power,
    target_signed_power,
    trusted_signed_power,
    used_trusted_indices,
    last_target,
  } = input_datum.phase
  let (
    next_accumulator,
    next_total_power,
    next_signed_power,
    next_trusted_power,
    next_used_indices,
    next_last_target,
  ) =
    accumulate_expected_non_adjacent_entries(
      entries,
      target_accumulator,
      target_total_power,
      target_signed_power,
      trusted_signed_power,
      used_trusted_indices,
      last_target,
    )
  SessionDatum {
    ..input_datum,
    phase: NonAdjacentTarget {
      trusted_root,
      trusted_total_power,
      target_accumulator: next_accumulator,
      target_total_power: next_total_power,
      target_signed_power: next_signed_power,
      trusted_signed_power: next_trusted_power,
      used_trusted_indices: next_used_indices,
      last_target: next_last_target,
    },
  }
}

test real_non_adjacent_six_membership_fixture_setup_baseline() {
  let (input_datum, entries) = real_non_adjacent_batch()
  let expected = expected_non_adjacent_continuation(input_datum, entries)
  expect NonAdjacentTarget { target_accumulator, .. } = expected.phase
  target_accumulator.count == 12
}

test advances_real_non_adjacent_six_membership_target_batch() {
  let (input_datum, entries) = real_non_adjacent_batch()
  let input = session_input(input_datum)
  let redeemer = VerifyTarget { entries }
  let expected = expected_non_adjacent_continuation(input_datum, entries)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [owner],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

fn take_target_entries_with_precomputed_memberships(
  validators: List<Validator>,
  signatures: List<CommitSig>,
  memberships: List<TrustedMembership>,
) -> List<TargetEntry> {
  when memberships is {
    [] -> []
    [trusted_membership, ..rest_memberships] -> {
      expect [target_validator, ..rest_validators] = validators
      expect [commit_sig, ..rest_signatures] = signatures
      [
        TargetEntry {
          target_validator,
          commit_sig,
          trusted_membership: Some(trusted_membership),
        },
        ..take_target_entries_with_precomputed_memberships(
          rest_validators,
          rest_signatures,
          rest_memberships,
        )
      ]
    }
  }
}

fn depth_eight_non_adjacent_batch() -> (SessionDatum, List<TargetEntry>) {
  expect Some(data) =
    cbor.deserialise(non_adjacent_mixed_spend_client_redeemer_cbor)
  expect redeemer: SpendClientRedeemer = data
  expect UpdateTendermintClient{msg: HeaderCase(header)} = redeemer
  let target_validators = header.validator_set.validators
  let signed_header = header.signed_header
  let tm_header = signed_header.header
  let commit = signed_header.commit
  let (_, remaining_validators) = list.span(target_validators, 6)
  let (_, remaining_signatures) = list.span(commit.signatures, 6)
  let first_batch = take_target_entries(target_validators, commit.signatures, 6)
  let second_batch =
    take_target_entries_with_precomputed_memberships(
      remaining_validators,
      remaining_signatures,
      depth_eight.memberships(),
    )
  let fixture_plan =
    UpdatePlan {
      client_token: client_auth_token(),
      trusted_height: header.trusted_height,
      trusted_consensus_state: ConsensusState {
        timestamp: non_adjacent_mixed_trusted_timestamp,
        next_validators_hash: depth_eight.trusted_root,
        root: merkle.new_merkle_root(non_adjacent_mixed_trusted_app_hash),
      },
      trust_level: unchecked_rational.new(1, 3),
      trusting_period: 1_209_600_000_000_000,
      max_clock_drift: 10_000_000_000,
      header: tm_header,
      commit: CommitCore {
        height: commit.height,
        round: commit.round,
        block_id: commit.block_id,
      },
      target_validator_count: list.length(target_validators),
      trusted_validator_count: 256,
    }
  let (
    target_accumulator,
    target_total_power,
    target_signed_power,
    _,
    _,
    last_target,
  ) =
    accumulate_expected_non_adjacent_entries(
      first_batch,
      merkle_accumulator.empty(),
      0,
      0,
      0,
      0,
      None,
    )
  (
    SessionDatum {
      session_token: session_auth_token(),
      owner,
      plan: fixture_plan,
      phase: NonAdjacentTarget {
        trusted_root: depth_eight.trusted_root,
        trusted_total_power: depth_eight.trusted_total_power,
        target_accumulator,
        target_total_power,
        target_signed_power,
        trusted_signed_power: 0,
        used_trusted_indices: 0,
        last_target,
      },
    },
    second_batch,
  )
}

fn depth_eight_non_adjacent_context() -> (
  SessionDatum,
  List<TargetEntry>,
  Input,
  SessionDatum,
  Transaction,
) {
  let (input_datum, entries) = depth_eight_non_adjacent_batch()
  let input = session_input(input_datum)
  let expected = expected_non_adjacent_continuation(input_datum, entries)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [owner],
    }
  (input_datum, entries, input, expected, transaction)
}

fn depth_eight_non_adjacent_fixture_is_constructed(
  input_datum: SessionDatum,
  entries: List<TargetEntry>,
  input: Input,
  expected: SessionDatum,
  transaction: Transaction,
) -> Bool {
  expect NonAdjacentTarget { target_accumulator, used_trusted_indices, .. } =
    expected.phase
  expect [transaction_input] = transaction.inputs
  expect [transaction_output] = transaction.outputs
  and {
    transaction_input == input,
    input.output.datum == InlineDatum(input_datum),
    transaction_output == continuation(input, expected),
    list.length(entries) == 6,
    list.all(
      entries,
      fn(entry) {
        when entry.trusted_membership is {
          Some(membership) -> list.length(membership.audit_path) == 8
          None -> False
        }
      },
    ),
    target_accumulator.count == 12,
    used_trusted_indices == depth_eight.used_trusted_indices,
  }
}

test depth_eight_non_adjacent_six_membership_fixture_setup_baseline() {
  let (input_datum, entries, input, expected, transaction) =
    depth_eight_non_adjacent_context()
  depth_eight_non_adjacent_fixture_is_constructed(
    input_datum,
    entries,
    input,
    expected,
    transaction,
  )
}

test advances_depth_eight_non_adjacent_six_membership_target_batch() {
  let (input_datum, entries, input, expected, transaction) =
    depth_eight_non_adjacent_context()
  expect
    depth_eight_non_adjacent_fixture_is_constructed(
      input_datum,
      entries,
      input,
      expected,
      transaction,
    )

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    VerifyTarget { entries },
    input.output_reference,
    transaction,
  )
}

test advances_only_to_the_exact_computed_continuation() {
  let input_datum = datum()
  let input = session_input(input_datum)
  let redeemer = VerifyTarget { entries: [entry()] }
  let expected = session.advance(input_datum, redeemer)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [owner],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

test rejects_forged_intermediate_datum() fail {
  let input_datum = datum()
  let input = session_input(input_datum)
  let redeemer = VerifyTarget { entries: [entry()] }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, input_datum)],
      mint: zero,
      extra_signatories: [owner],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

test non_owner_cannot_advance_target_session() fail {
  let input_datum = datum()
  let input = session_input(input_datum)
  let redeemer = VerifyTarget { entries: [entry()] }
  let expected = session.advance(input_datum, redeemer)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [
        #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

fn non_adjacent_trusted_datum() -> SessionDatum {
  let base_plan = plan()
  let header = TmHeader { ..base_plan.header, height: 12 }
  let non_adjacent_plan =
    UpdatePlan {
      ..base_plan,
      header,
      commit: CommitCore {
        ..base_plan.commit,
        height: header.height,
        block_id: BlockID {
          ..base_plan.commit.block_id,
          hash: tm_header_mod.hash(header),
        },
      },
      trusted_validator_count: 2,
    }
  session.initial_datum(session_auth_token(), owner, non_adjacent_plan)
}

test owner_can_advance_trusted_session() {
  let input_datum = non_adjacent_trusted_datum()
  let input = session_input(input_datum)
  let redeemer = VerifyTrusted { validators: [entry().target_validator] }
  let expected = session.advance(input_datum, redeemer)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [owner],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

test non_owner_cannot_advance_trusted_session() fail {
  let input_datum = non_adjacent_trusted_datum()
  let input = session_input(input_datum)
  let redeemer = VerifyTrusted { validators: [entry().target_validator] }
  let expected = session.advance(input_datum, redeemer)
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      outputs: [continuation(input, expected)],
      mint: zero,
      extra_signatories: [
        #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    redeemer,
    input.output_reference,
    transaction,
  )
}

test owner_can_cancel_and_burn_the_session_token() {
  let input_datum = datum()
  let input = session_input(input_datum)
  let token = input_datum.session_token
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      mint: from_asset(token.policy_id, token.name, -1),
      extra_signatories: [owner],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    Cancel,
    input.output_reference,
    transaction,
  )
}

test non_owner_cannot_cancel() fail {
  let input_datum = datum()
  let input = session_input(input_datum)
  let token = input_datum.session_token
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input],
      mint: from_asset(token.policy_id, token.name, -1),
      extra_signatories: [
        #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Some(input_datum),
    Cancel,
    input.output_reference,
    transaction,
  )
}

fn finalize_context() -> (PolicyId, SessionDatum, OutputReference, Transaction) {
  let initial = datum()
  let input_datum =
    SessionDatum {
      ..initial,
      phase: Complete {
        target_root: validator_root,
        target_total_power: 1,
        target_signed_power: 1,
        trusted_root: None,
        trusted_total_power: 0,
        trusted_signed_power: 0,
      },
    }
  let input = session_input(input_datum)
  let session_token = input_datum.session_token
  let client_token = input_datum.plan.client_token
  let client_ref =
    output_ref(
      #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      0,
    )
  let client_output =
    Output {
      address: from_script(
        #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      ),
      value: from_asset(client_token.policy_id, client_token.name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  let client_input =
    Input { output_reference: client_ref, output: client_output }
  let host_policy: PolicyId =
    #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  let host_ref =
    output_ref(
      #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      0,
    )
  let host_output =
    Output {
      address: from_script(
        #"01010101010101010101010101010101010101010101010101010101",
      ),
      value: from_asset(host_policy, host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  let host_input = Input { output_reference: host_ref, output: host_output }
  let host_redeemer: Redeemer =
    UpdateClient {
      client_state_siblings: [],
      consensus_state_siblings: [],
      removed_consensus_state_siblings: [],
    }
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [input, client_input, host_input],
      outputs: [client_output, host_output],
      mint: from_asset(session_token.policy_id, session_token.name, -1),
      redeemers: [Pair(Spend(host_ref), host_redeemer)],
      extra_signatories: [owner],
    }

  (host_policy, input_datum, input.output_reference, transaction)
}

fn session_finalize_fixture_is_constructed(
  host_policy: PolicyId,
  input_datum: SessionDatum,
  input_ref: OutputReference,
  transaction: Transaction,
) -> Bool {
  expect [session_input, client_input, host_input] = transaction.inputs
  and {
    host_policy != #"",
    input_datum.session_token.policy_id != #"",
    session_input.output_reference == input_ref,
    client_input.output_reference != input_ref,
    host_input.output_reference != input_ref,
  }
}

test session_finalize_fixture_setup_baseline() {
  let (host_policy, input_datum, input_ref, transaction) = finalize_context()
  session_finalize_fixture_is_constructed(
    host_policy,
    input_datum,
    input_ref,
    transaction,
  )
}

test complete_session_requires_client_and_host_threads_and_burn() {
  let (host_policy, input_datum, input_ref, transaction) = finalize_context()
  expect
    session_finalize_fixture_is_constructed(
      host_policy,
      input_datum,
      input_ref,
      transaction,
    )

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    host_policy,
    Some(input_datum),
    Finalize,
    input_ref,
    transaction,
  )
}

test non_owner_cannot_finalize_complete_session() fail {
  let (host_policy, input_datum, input_ref, owner_transaction) =
    finalize_context()
  let transaction =
    Transaction {
      ..owner_transaction,
      extra_signatories: [
        #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
    }

  spending_tendermint_update_session.spend_tendermint_update_session.spend(
    host_policy,
    Some(input_datum),
    Finalize,
    input_ref,
    transaction,
  )
}
