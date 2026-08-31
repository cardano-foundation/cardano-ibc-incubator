use aiken/builtin
use aiken/collection/list
use aiken/math
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID} as block_id
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height
use ibc/utils/tx_time.{TxTime}

const packed_reference_format_version = 1

// CometBFT types.MaxTotalVotingPower = math.MaxInt64 / 8.
const max_total_voting_power = 1_152_921_504_606_846_975

const signed_int64_boundary = 9_223_372_036_854_775_808

const unsigned_int64_modulus = 18_446_744_073_709_551_616

/// Wire-compatible with the Gateway `Data.Object` field order. Validator
/// public keys and signed int64 voting powers occupy fixed-width blobs.
pub type PackedValidatorSetReference {
  format_version: Int,
  validator_set_hash: ByteArray,
  validator_count: Int,
  public_keys: ByteArray,
  voting_powers: ByteArray,
  total_voting_power: Int,
}

/// Address, proposer priority, proposer and relayed total power are omitted.
/// CometBFT's validator-set hash commits only to public key and voting power.
pub type CompactValidator {
  pubkey: ByteArray,
  voting_power: Int,
}

/// Commit fields shared by every selected signature.
pub type CompactCommit {
  height: Int,
  round: Int,
  block_id: BlockID,
}

/// Wire-oriented witness for generated gateway fixtures. One selected vote is
/// eight big-endian timestamp bytes plus one 64-byte Ed25519 signature; list
/// constructors and per-vote field wrappers are removed from the redeemer.
pub type PackedCommitWitness {
  signer_bitmap: ByteArray,
  timestamps: ByteArray,
  signatures: ByteArray,
}

/// Gateway compact commit field order. Height is intentionally omitted: the
/// adjacent verifier derives it from the full header instead of trusting a
/// second, independently supplied height.
pub type PackedHeaderCommit {
  round: Int,
  block_id: BlockID,
  signer_bitmap: ByteArray,
  timestamps: ByteArray,
  signatures: ByteArray,
}

/// Positionally matches Gateway's `CompactHeaderSchema`: full TmHeader,
/// compact commit and trusted Height.
pub type PackedAdjacentHeader {
  header: TmHeader,
  commit: PackedHeaderCommit,
  trusted_height: Height,
}

type PackedQuorumTally {
  signed_voting_power: Int,
  total_voting_power: Int,
  validator_count: Int,
  timestamp_offset: Int,
  signature_offset: Int,
}

type PackedValidatorEntry {
  compact_validator: CompactValidator,
  address: ByteArray,
}

/// Content validation for the Gateway datum. This can run while a reusable
/// certificate is registered or directly in update-client. It validates the
/// packed wire representation, reconstructs every CometBFT address, enforces
/// CometBFT's voting-power/address order, rejects duplicate addresses and
/// recomputes both the ordinary validator-set root and total voting power.
pub fn validate_packed_reference_certificate(
  reference: PackedValidatorSetReference,
) -> Bool {
  if !packed_reference_shape_is_valid(reference) {
    False
  } else {
    let entries = unpack_packed_validators(reference, 0)
    let derived_total =
      list.reduce(
        entries,
        0,
        fn(total, entry) { total + entry.compact_validator.voting_power },
      )

    and {
      list.all(
        entries,
        fn(entry) { packed_voting_power_is_valid(entry.compact_validator) },
      ),
      derived_total == reference.total_voting_power,
      derived_total <= max_total_voting_power,
      packed_validators_are_canonical(entries),
      packed_validator_addresses_are_unique(entries),
      reference.validator_set_hash == hash_packed_entries(entries),
    }
  }
}

/// Recompute CometBFT's normal validator-set hash from the compact entries.
pub fn hash_validators(validators: List<CompactValidator>) -> ByteArray {
  validators
    |> list.map(
        fn(compact_validator) {
          tm_validator.bytes(
            Validator {
              address: #"",
              pubkey: compact_validator.pubkey,
              voting_power: compact_validator.voting_power,
              proposer_priority: 0,
            },
          )
        },
      )
    |> tree.hash_from_byte_slices_sha2_256()
}

/// Verify the packed commit using the existing canonical vote encoding and
/// Ed25519 builtin.
pub fn verify_packed_compact_commit(
  reference: PackedValidatorSetReference,
  expected_validator_set_hash: ByteArray,
  chain_id: ByteArray,
  commit: CompactCommit,
  witness: PackedCommitWitness,
) -> Bool {
  let commit_for_sign_bytes =
    Commit {
      height: commit.height,
      round: commit.round,
      block_id: commit.block_id,
      signatures: [],
    }

  verify_packed_quorum_from_authenticated_reference(
    reference,
    expected_validator_set_hash,
    witness,
    fn(selected_validator, _validator_index, timestamp, signature) {
      let commit_signature =
        CommitSig {
          block_id_flag: block_id_flag_commit,
          validator_address: #"",
          timestamp,
          signature,
        }
      let sign_bytes =
        vote.vote_sign_bytes_for_commit_sig(
          commit_for_sign_bytes,
          chain_id,
          commit_signature,
        )

      builtin.verify_ed25519_signature(
        selected_validator.pubkey,
        sign_bytes,
        signature,
      )
    },
  )
}

/// Binds a compact quorum to the ICS-07 header, height and time fields modeled
/// by this adjacent prototype before running any Ed25519 checks. The caller
/// must look up the supplied trusted consensus state from the client datum and
/// must either validate the reference content in the same evaluation or
/// authenticate a certificate created by that validation.
pub fn verify_packed_adjacent_header(
  client_state: ClientState,
  trusted_consensus_state: ConsensusState,
  reference: PackedValidatorSetReference,
  update: PackedAdjacentHeader,
  tx_time: TxTime,
) -> Bool {
  let target_header = update.header
  let packed_commit = update.commit
  let trusted_height = update.trusted_height

  let state_is_bound = and {
      tm_header.validate_basic(target_header),
      block_id.validate_basic(packed_commit.block_id),
      packed_commit.round >= 0,
      tm_header.hash(target_header) == packed_commit.block_id.hash,
      target_header.chain_id == client_state.chain_id,
      trusted_height.revision_number >= 0,
      trusted_height.revision_height > 0,
      trusted_height.revision_number == client_state.latest_height.revision_number,
      trusted_height.revision_number == height.parse_chain_id(
        client_state.chain_id,
      ),
      target_header.height == trusted_height.revision_height + 1,
      target_header.height > client_state.latest_height.revision_height,
      target_header.validators_hash == reference.validator_set_hash,
      trusted_consensus_state.next_validators_hash == reference.validator_set_hash,
      client_state.trusting_period > 0,
      client_state.max_clock_drift > 0,
      tx_time.valid_from <= tx_time.valid_to,
      trusted_consensus_state.timestamp + client_state.trusting_period > tx_time.valid_to,
      target_header.time > trusted_consensus_state.timestamp,
      target_header.time < tx_time.valid_from + client_state.max_clock_drift,
    }

  if !state_is_bound {
    False
  } else {
    verify_packed_compact_commit(
      reference,
      target_header.validators_hash,
      client_state.chain_id,
      CompactCommit {
        height: target_header.height,
        round: packed_commit.round,
        block_id: packed_commit.block_id,
      },
      PackedCommitWitness {
        signer_bitmap: packed_commit.signer_bitmap,
        timestamps: packed_commit.timestamps,
        signatures: packed_commit.signatures,
      },
    )
  }
}

/// Verify packed vote mapping and voting power independently of signature
/// implementation. Generated fixtures can use this seam for semantic tests,
/// while execution tests call `verify_packed_compact_commit`.
pub fn verify_packed_quorum_from_authenticated_reference(
  reference: PackedValidatorSetReference,
  expected_validator_set_hash: ByteArray,
  witness: PackedCommitWitness,
  verify_vote: fn(CompactValidator, Int, Int, ByteArray) -> Bool,
) -> Bool {
  if !packed_reference_shape_is_valid(reference) || expected_validator_set_hash != reference.validator_set_hash || !is_canonical_bitmap(
    witness.signer_bitmap,
    reference.validator_count,
  ) {
    False
  } else {
    when
      tally_packed_quorum(reference, witness, 0, 0, 0, 0, 0, verify_vote)
    is {
      None -> False
      Some(tally) -> and {
          tally.timestamp_offset == bytearray.length(witness.timestamps),
          tally.signature_offset == bytearray.length(witness.signatures),
          tally.validator_count == reference.validator_count,
          tally.total_voting_power == reference.total_voting_power,
          tally.signed_voting_power * 3 > tally.total_voting_power * 2,
        }
    }
  }
}

/// A bitmap has exactly ceil(validator_count / 8) bytes and no set bits outside
/// the validator set. Those two conditions give every selected vote one
/// canonical mapping.
pub fn is_canonical_bitmap(bitmap: ByteArray, validator_count: Int) -> Bool {
  if validator_count <= 0 {
    False
  } else {
    let expected_length = ( validator_count + 7 ) / 8

    if bytearray.length(bitmap) != expected_length {
      False
    } else {
      let used_bits_in_last_byte = validator_count % 8

      if used_bits_in_last_byte == 0 {
        True
      } else {
        bytearray.at(bitmap, expected_length - 1) < math.pow2(
          used_bits_in_last_byte,
        )
      }
    }
  }
}

fn signer_bit_is_set(bitmap: ByteArray, validator_index: Int) -> Bool {
  let byte = bytearray.at(bitmap, validator_index / 8)
  let mask = math.pow2(validator_index % 8)
  byte / mask % 2 == 1
}

fn tally_packed_quorum(
  reference: PackedValidatorSetReference,
  witness: PackedCommitWitness,
  validator_index: Int,
  signed_voting_power: Int,
  total_power: Int,
  timestamp_offset: Int,
  signature_offset: Int,
  verify_vote: fn(CompactValidator, Int, Int, ByteArray) -> Bool,
) -> Option<PackedQuorumTally> {
  if validator_index >= reference.validator_count {
    Some(
      PackedQuorumTally {
        signed_voting_power,
        total_voting_power: total_power,
        validator_count: validator_index,
        timestamp_offset,
        signature_offset,
      },
    )
  } else {
    let current_validator = packed_validator_at(reference, validator_index)

    if !packed_voting_power_is_valid(current_validator) || validator_index >= bytearray.length(
      witness.signer_bitmap,
    ) * 8 {
      None
    } else if signer_bit_is_set(witness.signer_bitmap, validator_index) {
      if timestamp_offset + 8 > bytearray.length(witness.timestamps) || signature_offset + 64 > bytearray.length(
        witness.signatures,
      ) {
        None
      } else {
        let timestamp = signed_int64_at(witness.timestamps, timestamp_offset)
        let signature =
          bytearray.slice(
            witness.signatures,
            signature_offset,
            signature_offset + 63,
          )

        if verify_vote(current_validator, validator_index, timestamp, signature) {
          tally_packed_quorum(
            reference,
            witness,
            validator_index + 1,
            signed_voting_power + current_validator.voting_power,
            total_power + current_validator.voting_power,
            timestamp_offset + 8,
            signature_offset + 64,
            verify_vote,
          )
        } else {
          None
        }
      }
    } else {
      tally_packed_quorum(
        reference,
        witness,
        validator_index + 1,
        signed_voting_power,
        total_power + current_validator.voting_power,
        timestamp_offset,
        signature_offset,
        verify_vote,
      )
    }
  }
}

fn packed_reference_shape_is_valid(
  reference: PackedValidatorSetReference,
) -> Bool {
  and {
    reference.format_version == packed_reference_format_version,
    reference.validator_count > 0,
    bytearray.length(reference.validator_set_hash) == 32,
    bytearray.length(reference.public_keys) == reference.validator_count * 32,
    bytearray.length(reference.voting_powers) == reference.validator_count * 8,
    reference.total_voting_power > 0,
    reference.total_voting_power <= max_total_voting_power,
  }
}

fn packed_validator_at(
  reference: PackedValidatorSetReference,
  validator_index: Int,
) -> CompactValidator {
  let public_key_offset = validator_index * 32
  let voting_power_offset = validator_index * 8

  CompactValidator {
    pubkey: bytearray.slice(
      reference.public_keys,
      public_key_offset,
      public_key_offset + 31,
    ),
    voting_power: signed_int64_at(reference.voting_powers, voting_power_offset),
  }
}

fn signed_int64_at(bytes: ByteArray, offset: Int) -> Int {
  let unsigned =
    bytes
      |> bytearray.slice(offset, offset + 7)
      |> bytearray.to_int_big_endian()

  if unsigned >= signed_int64_boundary {
    unsigned - unsigned_int64_modulus
  } else {
    unsigned
  }
}

fn packed_voting_power_is_valid(compact_validator: CompactValidator) -> Bool {
  and {
    bytearray.length(compact_validator.pubkey) == 32,
    compact_validator.voting_power > 0,
    compact_validator.voting_power <= max_total_voting_power,
  }
}

fn validator_address(public_key: ByteArray) -> ByteArray {
  public_key |> builtin.sha2_256() |> bytearray.take(20)
}

fn unpack_packed_validators(
  reference: PackedValidatorSetReference,
  validator_index: Int,
) -> List<PackedValidatorEntry> {
  if validator_index >= reference.validator_count {
    []
  } else {
    let compact_validator = packed_validator_at(reference, validator_index)
    [
      PackedValidatorEntry {
        address: validator_address(compact_validator.pubkey),
        compact_validator,
      },
      ..unpack_packed_validators(reference, validator_index + 1)
    ]
  }
}

fn hash_packed_entries(entries: List<PackedValidatorEntry>) -> ByteArray {
  entries
    |> list.map(
        fn(entry) {
          tm_validator.bytes(
            Validator {
              address: #"",
              pubkey: entry.compact_validator.pubkey,
              voting_power: entry.compact_validator.voting_power,
              proposer_priority: 0,
            },
          )
        },
      )
    |> tree.hash_from_byte_slices_sha2_256()
}

fn packed_validators_are_canonical(entries: List<PackedValidatorEntry>) -> Bool {
  when entries is {
    [] -> False
    [first, ..rest] -> packed_entries_follow(first, rest)
  }
}

fn packed_entries_follow(
  previous: PackedValidatorEntry,
  entries: List<PackedValidatorEntry>,
) -> Bool {
  when entries is {
    [] -> True
    [current, ..rest] -> {
      let power_decreases =
        current.compact_validator.voting_power < previous.compact_validator.voting_power
      let equal_power_address_increases = and {
          current.compact_validator.voting_power == previous.compact_validator.voting_power,
          bytearray.compare(previous.address, current.address) == Less,
        }

      and {
        power_decreases || equal_power_address_increases,
        packed_entries_follow(current, rest),
      }
    }
  }
}

fn packed_validator_addresses_are_unique(
  entries: List<PackedValidatorEntry>,
) -> Bool {
  let addresses = list.map(entries, fn(entry) { entry.address })
  sorted_addresses_are_unique(sort_addresses(addresses, list.length(addresses)))
}

fn sorted_addresses_are_unique(addresses: List<ByteArray>) -> Bool {
  when addresses is {
    [] | [_] -> True
    [first, second, ..rest] -> and {
        bytearray.compare(first, second) == Less,
        sorted_addresses_are_unique([second, ..rest]),
      }
  }
}

fn sort_addresses(addresses: List<ByteArray>, count: Int) -> List<ByteArray> {
  if count <= 1 {
    addresses
  } else {
    let left_count = count / 2
    let (left, right) = list.span(addresses, left_count)
    merge_addresses(
      sort_addresses(left, left_count),
      sort_addresses(right, count - left_count),
    )
  }
}

fn merge_addresses(
  left: List<ByteArray>,
  right: List<ByteArray>,
) -> List<ByteArray> {
  when left is {
    [] -> right
    [left_head, ..left_tail] ->
      when right is {
        [] -> left
        [right_head, ..right_tail] ->
          if bytearray.compare(left_head, right_head) == Greater {
            [right_head, ..merge_addresses(left, right_tail)]
          } else {
            [left_head, ..merge_addresses(left_tail, right)]
          }
      }
  }
}
