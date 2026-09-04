use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/math
use aiken/math/rational
use aiken/primitive/bytearray
use cardano/transaction.{OutputReference}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id as block_id_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig as commit_sig_mod
use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_absent, block_id_flag_commit, block_id_flag_nil,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator} as tm_validator_mod
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/client/ics_007_tendermint_client/multitx/merkle_accumulator
use ibc/client/ics_007_tendermint_client/multitx/rfc6962_membership
use ibc/client/ics_007_tendermint_client/multitx/types.{
  AdjacentTarget, CommitCore, Complete, Finalize, NonAdjacentTarget,
  NonAdjacentTrusted, SessionDatum, SpendSessionRedeemer, TargetEntry,
  TrustedMembership, UpdatePlan, ValidatorOrderKey, VerifyTarget, VerifyTrusted,
  max_batch_size, max_total_voting_power, max_validator_count,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/utils/tx_time.{TxTime}

const session_id_domain = "cardano-ibc/tendermint-update-session/v1"

/// Stable logical identifier used for diagnostics and off-chain deduplication.
pub fn plan_hash(plan: UpdatePlan) -> ByteArray {
  session_id_domain
    |> bytearray.concat(cbor.serialise(plan))
    |> crypto.sha3_256()
}

/// Unique on-chain session token name. Including the consumed seed makes the
/// asset a true NFT even when the same logical plan is retried.
pub fn session_token_name(seed: OutputReference, plan: UpdatePlan) -> ByteArray {
  session_id_domain
    |> bytearray.concat(cbor.serialise(seed))
    |> bytearray.concat(plan_hash(plan))
    |> crypto.sha3_256()
}

pub fn is_adjacent(plan: UpdatePlan) -> Bool {
  plan.header.height == plan.trusted_height.revision_height + 1
}

/// Check all immutable, context-free plan invariants. Finalization must repeat
/// the context-sensitive checks against the live client and transaction time.
pub fn validate_plan_basic(plan: UpdatePlan) -> Bool {
  let UpdatePlan {
    trusted_height,
    trusted_consensus_state,
    trust_level,
    trusting_period,
    max_clock_drift,
    header,
    commit,
    target_validator_count,
    trusted_validator_count,
    ..
  } = plan
  expect Some(trust) = unchecked_rational.to_rational(trust_level)
  expect Some(min_trust) = rational.new(1, 3)
  expect Some(max_trust) = rational.new(1, 1)

  and {
    tm_header_mod.validate_basic(header),
    block_id_mod.validate_basic(commit.block_id),
    bytearray.length(header.validators_hash) == 32,
    bytearray.length(header.next_validators_hash) == 32,
    bytearray.length(trusted_consensus_state.next_validators_hash) == 32,
    commit.height == header.height,
    commit.round >= 0,
    commit.block_id.hash == tm_header_mod.hash(header),
    trusted_height.revision_height > 0,
    trusted_height.revision_number == height_mod.parse_chain_id(header.chain_id),
    header.height > trusted_height.revision_height,
    target_validator_count > 0,
    target_validator_count <= max_validator_count,
    if is_adjacent(plan) {
      trusted_validator_count == 0
    } else {
      trusted_validator_count > 0 && trusted_validator_count <= max_validator_count
    },
    trusting_period > 0,
    max_clock_drift > 0,
    rational.compare_with(trust, >=, min_trust),
    rational.compare_with(trust, <=, max_trust),
  }
}

pub fn initial_datum(
  session_token: AuthToken,
  owner: crypto.VerificationKeyHash,
  plan: UpdatePlan,
) -> SessionDatum {
  expect validate_plan_basic(plan)
  let phase =
    if is_adjacent(plan) {
      AdjacentTarget {
        target_accumulator: merkle_accumulator.empty(),
        target_total_power: 0,
        target_signed_power: 0,
        last_target: None,
      }
    } else {
      NonAdjacentTrusted {
        trusted_accumulator: merkle_accumulator.empty(),
        trusted_total_power: 0,
        last_trusted: None,
      }
    }
  SessionDatum { session_token, owner, plan, phase }
}

pub fn advance(
  datum: SessionDatum,
  redeemer: SpendSessionRedeemer,
) -> SessionDatum {
  when redeemer is {
    VerifyTrusted { validators } -> advance_trusted(datum, validators)
    VerifyTarget { entries } -> advance_target(datum, entries)
    Finalize | types.Cancel -> fail @"Terminal session action is not an advance"
  }
}

fn valid_batch_length(length: Int) -> Bool {
  length > 0 && length <= max_batch_size
}

/// CometBFT validator addresses are the first 20 bytes of SHA-256(pubkey).
/// Validator-set hashes omit the relayed address, so deriving it here is
/// essential before the address is used for trusted-set matching.
pub fn validate_validator(tm_val: Validator) -> Bool {
  and {
    bytearray.length(tm_val.pubkey) == 32,
    bytearray.length(tm_val.address) == 20,
    tm_val.address == (
      builtin.sha2_256(tm_val.pubkey)
        |> bytearray.take(20)
    ),
    tm_val.voting_power > 0,
  }
}

fn order_key(tm_val: Validator) -> ValidatorOrderKey {
  ValidatorOrderKey {
    voting_power: tm_val.voting_power,
    address: tm_val.address,
  }
}

/// CometBFT stores validators by descending voting power, breaking equal-power
/// ties by ascending address. Strictness rejects repeated identical entries.
fn follows_canonical_order(
  previous: Option<ValidatorOrderKey>,
  current: Validator,
) -> Bool {
  when previous is {
    None -> True
    Some(previous) -> current.voting_power < previous.voting_power || and {
        current.voting_power == previous.voting_power,
        bytearray.compare(previous.address, current.address) == Less,
      }
  }
}

fn add_voting_power(total: Int, voting_power: Int) -> Int {
  let next_total = total + voting_power
  expect next_total <= max_total_voting_power
  next_total
}

fn append_trusted_validators(
  validators: List<Validator>,
  accumulator: merkle_accumulator.MerkleAccumulator,
  total_power: Int,
  last_trusted: Option<ValidatorOrderKey>,
) -> (merkle_accumulator.MerkleAccumulator, Int, Option<ValidatorOrderKey>) {
  when validators is {
    [] -> (accumulator, total_power, last_trusted)
    [tm_val, ..rest] -> {
      expect validate_validator(tm_val)
      expect follows_canonical_order(last_trusted, tm_val)
      append_trusted_validators(
        rest,
        merkle_accumulator.append(accumulator, tm_validator_mod.bytes(tm_val)),
        add_voting_power(total_power, tm_val.voting_power),
        Some(order_key(tm_val)),
      )
    }
  }
}

fn advance_trusted(
  datum: SessionDatum,
  validators: List<Validator>,
) -> SessionDatum {
  let SessionDatum { plan, phase, .. } = datum
  expect NonAdjacentTrusted {
    trusted_accumulator,
    trusted_total_power,
    last_trusted,
  } = phase
  let batch_length = list.length(validators)
  expect valid_batch_length(batch_length)
  expect
    trusted_accumulator.count + batch_length <= plan.trusted_validator_count

  let (next_accumulator, next_total_power, next_last_trusted) =
    append_trusted_validators(
      validators,
      trusted_accumulator,
      trusted_total_power,
      last_trusted,
    )

  let next_phase =
    if next_accumulator.count == plan.trusted_validator_count {
      let trusted_root = merkle_accumulator.root(next_accumulator)
      expect trusted_root == plan.trusted_consensus_state.next_validators_hash
      NonAdjacentTarget {
        trusted_root,
        trusted_total_power: next_total_power,
        target_accumulator: merkle_accumulator.empty(),
        target_total_power: 0,
        target_signed_power: 0,
        trusted_signed_power: 0,
        used_trusted_indices: 0,
        last_target: None,
      }
    } else {
      NonAdjacentTrusted {
        trusted_accumulator: next_accumulator,
        trusted_total_power: next_total_power,
        last_trusted: next_last_trusted,
      }
    }

  SessionDatum { ..datum, phase: next_phase }
}

fn commit_from_core(core: CommitCore) -> Commit {
  Commit {
    height: core.height,
    round: core.round,
    block_id: core.block_id,
    signatures: [],
  }
}

fn validate_signature_slot(entry: TargetEntry) -> Bool {
  let TargetEntry { target_validator, commit_sig, .. } = entry
  and {
    validate_validator(target_validator),
    commit_sig_mod.validate_basic(commit_sig),
    if commit_sig.block_id_flag == block_id_flag_absent {
      True
    } else if commit_sig.block_id_flag == block_id_flag_commit || commit_sig.block_id_flag == block_id_flag_nil {
      commit_sig.validator_address == target_validator.address
    } else {
      False
    },
  }
}

fn verify_commit_signature(plan: UpdatePlan, entry: TargetEntry) -> Bool {
  let TargetEntry { target_validator, commit_sig, .. } = entry
  let commit = commit_from_core(plan.commit)
  builtin.verify_ed25519_signature(
    target_validator.pubkey,
    vote.vote_sign_bytes_for_commit_sig(
      commit,
      plan.header.chain_id,
      commit_sig,
    ),
    commit_sig.signature,
  )
}

fn include_trusted_power(
  plan: UpdatePlan,
  trusted_root: ByteArray,
  target: Validator,
  membership: TrustedMembership,
  trusted_signed_power: Int,
  used_trusted_indices: Int,
) -> (Int, Int) {
  let TrustedMembership { index, trusted_validator, audit_path } = membership
  expect validate_validator(trusted_validator)
  // Requiring the exact same public key is a collision-safe strengthening of
  // Tendermint's address lookup. The target signature already verified under
  // this key, so a second Ed25519 operation is unnecessary.
  expect trusted_validator.pubkey == target.pubkey
  expect
    rfc6962_membership.verify(
      trusted_root,
      tm_validator_mod.bytes(trusted_validator),
      index,
      plan.trusted_validator_count,
      audit_path,
    )
  let seen_bit = math.pow2(index)
  expect used_trusted_indices / seen_bit % 2 == 0
  (
    trusted_signed_power + trusted_validator.voting_power,
    used_trusted_indices + seen_bit,
  )
}

fn append_adjacent_entries(
  plan: UpdatePlan,
  entries: List<TargetEntry>,
  accumulator: merkle_accumulator.MerkleAccumulator,
  total_power: Int,
  signed_power: Int,
  last_target: Option<ValidatorOrderKey>,
) -> (merkle_accumulator.MerkleAccumulator, Int, Int, Option<ValidatorOrderKey>) {
  when entries is {
    [] -> (accumulator, total_power, signed_power, last_target)
    [entry, ..rest] -> {
      expect validate_signature_slot(entry)
      expect entry.trusted_membership == None
      expect follows_canonical_order(last_target, entry.target_validator)
      let next_signed_power =
        if entry.commit_sig.block_id_flag == block_id_flag_commit {
          expect verify_commit_signature(plan, entry)
          signed_power + entry.target_validator.voting_power
        } else {
          signed_power
        }
      append_adjacent_entries(
        plan,
        rest,
        merkle_accumulator.append(
          accumulator,
          tm_validator_mod.bytes(entry.target_validator),
        ),
        add_voting_power(total_power, entry.target_validator.voting_power),
        next_signed_power,
        Some(order_key(entry.target_validator)),
      )
    }
  }
}

fn append_non_adjacent_entries(
  plan: UpdatePlan,
  trusted_root: ByteArray,
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
      expect validate_signature_slot(entry)
      expect follows_canonical_order(last_target, entry.target_validator)
      let is_commit = entry.commit_sig.block_id_flag == block_id_flag_commit
      let next_signed_power =
        if is_commit {
          expect verify_commit_signature(plan, entry)
          signed_power + entry.target_validator.voting_power
        } else {
          expect entry.trusted_membership == None
          signed_power
        }
      let (next_trusted_signed_power, next_used_indices) =
        when entry.trusted_membership is {
          None -> (trusted_signed_power, used_trusted_indices)
          Some(membership) -> {
            expect is_commit
            include_trusted_power(
              plan,
              trusted_root,
              entry.target_validator,
              membership,
              trusted_signed_power,
              used_trusted_indices,
            )
          }
        }
      append_non_adjacent_entries(
        plan,
        trusted_root,
        rest,
        merkle_accumulator.append(
          accumulator,
          tm_validator_mod.bytes(entry.target_validator),
        ),
        add_voting_power(total_power, entry.target_validator.voting_power),
        next_signed_power,
        next_trusted_signed_power,
        next_used_indices,
        Some(order_key(entry.target_validator)),
      )
    }
  }
}

fn target_quorum(signed_power: Int, total_power: Int) -> Bool {
  signed_power * 3 > total_power * 2
}

fn trusted_quorum(plan: UpdatePlan, signed_power: Int, total_power: Int) -> Bool {
  expect Some(trust) = unchecked_rational.to_rational(plan.trust_level)
  signed_power * rational.denominator(trust) > total_power * rational.numerator(
    trust,
  )
}

fn advance_target(
  datum: SessionDatum,
  entries: List<TargetEntry>,
) -> SessionDatum {
  let SessionDatum { plan, phase, .. } = datum
  let batch_length = list.length(entries)
  expect valid_batch_length(batch_length)

  let next_phase =
    when phase is {
      AdjacentTarget {
        target_accumulator,
        target_total_power,
        target_signed_power,
        last_target,
      } -> {
        expect
          target_accumulator.count + batch_length <= plan.target_validator_count
        let (next_accumulator, next_total, next_signed, next_last_target) =
          append_adjacent_entries(
            plan,
            entries,
            target_accumulator,
            target_total_power,
            target_signed_power,
            last_target,
          )
        if next_accumulator.count == plan.target_validator_count {
          let target_root = merkle_accumulator.root(next_accumulator)
          expect target_root == plan.header.validators_hash
          expect
            target_root == plan.trusted_consensus_state.next_validators_hash
          expect target_quorum(next_signed, next_total)
          Complete {
            target_root,
            target_total_power: next_total,
            target_signed_power: next_signed,
            trusted_root: None,
            trusted_total_power: 0,
            trusted_signed_power: 0,
          }
        } else {
          AdjacentTarget {
            target_accumulator: next_accumulator,
            target_total_power: next_total,
            target_signed_power: next_signed,
            last_target: next_last_target,
          }
        }
      }
      NonAdjacentTarget {
        trusted_root,
        trusted_total_power,
        target_accumulator,
        target_total_power,
        target_signed_power,
        trusted_signed_power,
        used_trusted_indices,
        last_target,
      } -> {
        expect
          target_accumulator.count + batch_length <= plan.target_validator_count
        let (
          next_accumulator,
          next_total,
          next_signed,
          next_trusted_signed,
          next_used_indices,
          next_last_target,
        ) =
          append_non_adjacent_entries(
            plan,
            trusted_root,
            entries,
            target_accumulator,
            target_total_power,
            target_signed_power,
            trusted_signed_power,
            used_trusted_indices,
            last_target,
          )
        if next_accumulator.count == plan.target_validator_count {
          let target_root = merkle_accumulator.root(next_accumulator)
          expect target_root == plan.header.validators_hash
          expect target_quorum(next_signed, next_total)
          expect trusted_quorum(plan, next_trusted_signed, trusted_total_power)
          Complete {
            target_root,
            target_total_power: next_total,
            target_signed_power: next_signed,
            trusted_root: Some(trusted_root),
            trusted_total_power,
            trusted_signed_power: next_trusted_signed,
          }
        } else {
          NonAdjacentTarget {
            trusted_root,
            trusted_total_power,
            target_accumulator: next_accumulator,
            target_total_power: next_total,
            target_signed_power: next_signed,
            trusted_signed_power: next_trusted_signed,
            used_trusted_indices: next_used_indices,
            last_target: next_last_target,
          }
        }
      }
      _ -> fail @"Target batch submitted in the wrong session phase"
    }

  SessionDatum { ..datum, phase: next_phase }
}

/// Defensive terminal-state validation for the final client validator.
pub fn is_complete_valid(datum: SessionDatum) -> Bool {
  let SessionDatum { plan, phase, .. } = datum
  expect validate_plan_basic(plan)
  when phase is {
    Complete {
      target_root,
      target_total_power,
      target_signed_power,
      trusted_root,
      trusted_total_power,
      trusted_signed_power,
    } -> and {
        target_root == plan.header.validators_hash,
        target_total_power > 0,
        target_total_power <= max_total_voting_power,
        target_signed_power >= 0,
        target_signed_power <= target_total_power,
        target_quorum(target_signed_power, target_total_power),
        if is_adjacent(plan) {
          and {
            target_root == plan.trusted_consensus_state.next_validators_hash,
            trusted_root == None,
            trusted_total_power == 0,
            trusted_signed_power == 0,
          }
        } else {
          and {
            trusted_root == Some(
              plan.trusted_consensus_state.next_validators_hash,
            ),
            trusted_total_power > 0,
            trusted_total_power <= max_total_voting_power,
            trusted_signed_power >= 0,
            trusted_signed_power <= trusted_total_power,
            trusted_quorum(plan, trusted_signed_power, trusted_total_power),
          }
        },
      }
    _ -> False
  }
}

/// Bind an authenticated Complete session to the live client and the final
/// transaction's time range. This deliberately repeats every time-sensitive
/// header check at finalization; work done in earlier transactions never gets
/// to freeze a stale notion of "now" or of the current client state.
pub fn validate_finalization(
  datum: SessionDatum,
  client_datum: ClientDatum,
  tx_time: TxTime,
) -> Bool {
  let SessionDatum { plan, .. } = datum
  let current_state = client_datum.state.client_state
  expect [trusted_consensus_state] =
    pairs.get_all(client_datum.state.consensus_states, plan.trusted_height)
  expect [latest_consensus_state] =
    pairs.get_all(
      client_datum.state.consensus_states,
      current_state.latest_height,
    )
  let target_height =
    height_mod.Height {
      revision_number: height_mod.parse_chain_id(plan.header.chain_id),
      revision_height: plan.header.height,
    }

  and {
    is_complete_valid(datum),
    tx_time.valid_from <= tx_time.valid_to,
    client_datum.token == plan.client_token,
    current_state.chain_id == plan.header.chain_id,
    current_state.trust_level == plan.trust_level,
    current_state.trusting_period == plan.trusting_period,
    current_state.max_clock_drift == plan.max_clock_drift,
    trusted_consensus_state == plan.trusted_consensus_state,
    client_state_mod.status(
      current_state,
      tx_time.valid_to,
      client_datum.state.consensus_states,
    ) == Active,
    height_mod.compare(target_height, current_state.latest_height) == Greater,
    target_height.revision_number == plan.trusted_height.revision_number,
    plan.header.time > trusted_consensus_state.timestamp,
    // A higher-height header with an equal or earlier timestamp is Header-case
    // Tendermint misbehaviour. The staged protocol cannot freeze clients yet,
    // so reject it rather than install a non-monotonic consensus state.
    plan.header.time > latest_consensus_state.timestamp,
    trusted_consensus_state.timestamp + current_state.trusting_period > tx_time.valid_to,
    plan.header.time < tx_time.valid_from + current_state.max_clock_drift,
  }
}
