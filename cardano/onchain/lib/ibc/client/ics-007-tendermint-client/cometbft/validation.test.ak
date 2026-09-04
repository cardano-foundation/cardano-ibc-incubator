use aiken/collection/list
use aiken/math/rational
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_absent, block_id_flag_commit, block_id_flag_nil,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{
  Validator, max_voting_power,
}
use ibc/client/ics_007_tendermint_client/cometbft/validation
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet} as validator_set_mod
use ibc/client/ics_007_tendermint_client/cometbft/vote
use ibc/utils/int.{max_uint64}

const chain_id = "testchain2-1"

fn validators() -> List<Validator> {
  [
    Validator {
      address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
      voting_power: 1,
      proposer_priority: -3,
    },
    Validator {
      address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
      pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
      voting_power: 1,
      proposer_priority: 1,
    },
    Validator {
      address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
      pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
      voting_power: 1,
      proposer_priority: 1,
    },
    Validator {
      address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
      pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
      voting_power: 1,
      proposer_priority: 1,
    },
  ]
}

fn validator_set() -> ValidatorSet {
  expect [proposer, ..] = validators()
  ValidatorSet { validators: validators(), proposer, total_voting_power: 4 }
}

fn wrapped_validator_set() -> ValidatorSet {
  let vals = validator_set()
  expect [first, ..rest] = vals.validators
  ValidatorSet {
    ..vals,
    validators: [
      Validator { ..first, voting_power: first.voting_power - max_uint64 },
      ..rest
    ],
  }
}

fn overflowing_validator_set() -> ValidatorSet {
  expect [first, second, ..] = validators()
  ValidatorSet {
    validators: [Validator { ..first, voting_power: max_voting_power }, second],
    proposer: first,
    total_voting_power: max_voting_power + second.voting_power,
  }
}

fn commit_signatures() -> List<CommitSig> {
  [
    CommitSig {
      block_id_flag: block_id_flag_commit,
      validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      timestamp: 1577836805000000000,
      signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
    },
    CommitSig {
      block_id_flag: block_id_flag_commit,
      validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
      timestamp: 1577836805000000000,
      signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
    },
    CommitSig {
      block_id_flag: block_id_flag_commit,
      validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
      timestamp: 1577836805000000000,
      signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
    },
    CommitSig {
      block_id_flag: block_id_flag_commit,
      validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
      timestamp: 1577836805000000000,
      signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
    },
  ]
}

fn commit_with(signatures: List<CommitSig>) -> Commit {
  Commit {
    height: 3,
    round: 1,
    block_id: BlockID {
      hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
      part_set_header: PartSetHeader {
        total: 3,
        hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
      },
    },
    signatures,
  }
}

fn unsigned_commit(signature_count: Int) -> Commit {
  let absent =
    CommitSig {
      block_id_flag: block_id_flag_absent,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    }
  commit_with(list.repeat(absent, signature_count))
}

fn one_third() -> rational.Rational {
  expect Some(trust_level) = rational.new(1, 3)
  trust_level
}

fn three_quarters() -> rational.Rational {
  expect Some(trust_level) = rational.new(3, 4)
  trust_level
}

fn vote_bytes_for(commit: Commit) -> List<ByteArray> {
  list.map(
    commit.signatures,
    fn(commit_sig) {
      vote.vote_sign_bytes_for_commit_sig(commit, chain_id, commit_sig)
    },
  )
}

test trusting_commit_accepts_valid_overlap() {
  validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    commit_with(commit_signatures()),
    one_third(),
    None,
  )
}

test trusting_commit_accepts_reordered_trusted_validators() {
  expect [first, second, third, fourth] = validators()
  let reordered = [fourth, second, first, third]
  let test_commit = commit_with(commit_signatures())

  validation.verify_commit_light_trusting(
    chain_id,
    ValidatorSet {
      validators: reordered,
      proposer: fourth,
      total_voting_power: 4,
    },
    test_commit,
    three_quarters(),
    Some(vote_bytes_for(test_commit)),
  )
}

test trusting_commit_selects_first_wire_entry_for_duplicate_address() {
  expect [first, second, ..] = validators()
  expect [first_signature, ..] = commit_signatures()
  let duplicate_address = Validator { ..second, address: first.address }

  validation.verify_commit_light_trusting(
    chain_id,
    ValidatorSet {
      validators: [first, duplicate_address],
      proposer: first,
      total_voting_power: 2,
    },
    commit_with([first_signature]),
    one_third(),
    None,
  )
}

test trusting_commit_ignores_absent_and_nil_slots() {
  expect [_first, second, third, fourth] = commit_signatures()
  let absent =
    CommitSig {
      block_id_flag: block_id_flag_absent,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    }
  let nil = CommitSig { ..second, block_id_flag: block_id_flag_nil }

  validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    commit_with([absent, nil, third, fourth]),
    one_third(),
    None,
  )
}

test trusting_commit_requires_strictly_more_than_threshold() {
  expect [_first, _second, _third, fourth] = commit_signatures()
  let absent =
    CommitSig {
      block_id_flag: block_id_flag_absent,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    }

  !validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    commit_with([absent, absent, absent, fourth]),
    one_third(),
    None,
  )
}

test trusting_commit_rejects_duplicate_before_threshold() fail {
  expect [_first, _second, _third, fourth] = commit_signatures()
  let absent =
    CommitSig {
      block_id_flag: block_id_flag_absent,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    }

  validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    commit_with([absent, absent, fourth, fourth]),
    one_third(),
    None,
  )
}

test trusting_commit_skips_duplicate_after_reverse_quorum() {
  expect [_first, _second, third, fourth] = commit_signatures()
  let absent =
    CommitSig {
      block_id_flag: block_id_flag_absent,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    }

  validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    commit_with([fourth, absent, third, fourth]),
    one_third(),
    None,
  )
}

test trusting_commit_allows_truncated_cache_for_unneeded_slots() {
  expect [first, second, _third, _fourth] = commit_signatures()
  let absent =
    CommitSig {
      block_id_flag: block_id_flag_absent,
      validator_address: #"",
      timestamp: 0,
      signature: #"",
    }
  let unknown = unknown_commit_signature(1)
  let test_commit = commit_with([first, second, unknown, absent])
  let full_cache = vote_bytes_for(test_commit)
  expect [first_bytes, second_bytes, ..] = full_cache

  validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    test_commit,
    one_third(),
    Some([first_bytes, second_bytes]),
  )
}

test trusting_commit_rejects_truncated_cache_for_needed_slot() fail {
  let test_commit = commit_with(commit_signatures())
  let full_cache = vote_bytes_for(test_commit)
  expect [first_bytes, second_bytes, third_bytes, ..] = full_cache

  validation.verify_commit_light_trusting(
    chain_id,
    validator_set(),
    test_commit,
    one_third(),
    Some([first_bytes, second_bytes, third_bytes]),
  )
}

fn synthetic_validator(index: Int) -> Validator {
  Validator {
    address: bytearray.from_int_big_endian(index, 20),
    pubkey: #"",
    voting_power: 1,
    proposer_priority: 0,
  }
}

fn unknown_commit_signature(index: Int) -> CommitSig {
  CommitSig {
    block_id_flag: block_id_flag_commit,
    validator_address: bytearray.from_int_big_endian(index + 1_000, 20),
    timestamp: 1577836805000000000,
    signature: bytearray.from_int_big_endian(0, 64),
  }
}

/// Scaling guard for the address-matching path. Every signature is well-shaped
/// for indexing but unknown to the trusted set, so no Ed25519 fixture is needed.
test trusting_commit_45_unknown_addresses_is_insufficient() {
  let indices = list.range(1, 45)
  let trusted_validators = list.map(indices, synthetic_validator)
  expect [proposer, ..] = trusted_validators
  let vals =
    ValidatorSet {
      validators: trusted_validators,
      proposer,
      total_voting_power: 45,
    }
  let commit = commit_with(list.map(indices, unknown_commit_signature))

  !validation.verify_commit_light_trusting(
    chain_id,
    vals,
    commit,
    one_third(),
    Some(list.repeat(#"", 45)),
  )
}

test wrapped_voting_power_hash_collision_is_invalid() {
  let honest = validator_set()
  let wrapped = wrapped_validator_set()

  validator_set_mod.hash(wrapped) == validator_set_mod.hash(honest) && !validator_set_mod.validate_basic(
    wrapped,
  )
}

test adjacent_verifier_rejects_wrapped_voting_power() fail {
  let vals = wrapped_validator_set()
  let commit = unsigned_commit(4)

  validation.verify_commit_light(
    chain_id,
    vals,
    commit.block_id,
    commit.height,
    commit,
    None,
  )
}

test trusting_verifier_rejects_wrapped_voting_power() fail {
  validation.verify_commit_light_trusting(
    chain_id,
    wrapped_validator_set(),
    unsigned_commit(4),
    one_third(),
    None,
  )
}

test adjacent_verifier_rejects_overflowing_total_voting_power() fail {
  let vals = overflowing_validator_set()
  let commit = unsigned_commit(2)

  validation.verify_commit_light(
    chain_id,
    vals,
    commit.block_id,
    commit.height,
    commit,
    None,
  )
}

test trusting_verifier_rejects_overflowing_total_voting_power() fail {
  validation.verify_commit_light_trusting(
    chain_id,
    overflowing_validator_set(),
    unsigned_commit(2),
    one_third(),
    None,
  )
}
