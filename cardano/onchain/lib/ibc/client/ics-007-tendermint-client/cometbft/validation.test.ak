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
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validation
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}

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

fn one_third() -> rational.Rational {
  expect Some(trust_level) = rational.new(1, 3)
  trust_level
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
