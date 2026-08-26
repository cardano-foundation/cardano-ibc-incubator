use aiken/builtin
use aiken/collection/list
use ibc/client/ics_007_tendermint_client/cometbft/adjacent_validation
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  block_id_flag_commit,
}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/vote

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

fn commit_signatures() -> List<CommitSig> {
  [
    CommitSig {
      block_id_flag: 2,
      validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      timestamp: 1577836805000000000,
      signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
    },
    CommitSig {
      block_id_flag: 2,
      validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
      timestamp: 1577836805000000000,
      signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
    },
    CommitSig {
      block_id_flag: 2,
      validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
      timestamp: 1577836805000000000,
      signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
    },
    CommitSig {
      block_id_flag: 2,
      validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
      timestamp: 1577836805000000000,
      signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
    },
  ]
}

fn absent_signature() -> CommitSig {
  CommitSig {
    block_id_flag: 1,
    validator_address: #"",
    timestamp: 0,
    signature: #"",
  }
}

fn commit(signatures: List<CommitSig>) -> Commit {
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

/// Reference implementation of the old indexed adjacent verifier. Keeping it
/// in tests lets the optimized traversal be checked against the prior behavior
/// without retaining the quadratic path in production code.
fn verify_with_indexed_reference(
  validators: List<Validator>,
  commit: Commit,
  voting_power_needed: Int,
  list_vote_sign_bytes: Option<List<ByteArray>>,
) -> Bool {
  let (tallied_voting_power, partial_passed) =
    list.indexed_foldr(
      commit.signatures,
      (0, False),
      fn(idx, current_signature, acc) {
        if current_signature.block_id_flag != block_id_flag_commit || acc.2nd {
          acc
        } else {
          expect Some(current_validator) = list.at(validators, idx)
          let vote_sign_bytes =
            when list_vote_sign_bytes is {
              Some(sign_bytes) -> {
                expect Some(bytes) = list.at(sign_bytes, idx)
                bytes
              }
              None -> vote.vote_sign_bytes_for_commit(commit, chain_id, idx)
            }

          expect
            builtin.verify_ed25519_signature(
              current_validator.pubkey,
              vote_sign_bytes,
              current_signature.signature,
            )

          let new_tallied_voting_power =
            acc.1st + current_validator.voting_power

          if new_tallied_voting_power > voting_power_needed {
            (new_tallied_voting_power, True)
          } else {
            (new_tallied_voting_power, False)
          }
        }
      },
    )

  partial_passed || tallied_voting_power > voting_power_needed
}

fn verification_results_match(signatures: List<CommitSig>) -> Bool {
  let test_commit = commit(signatures)
  let voting_power_needed = 2
  let sign_bytes =
    list.indexed_map(
      signatures,
      fn(idx, _signature) {
        vote.vote_sign_bytes_for_commit(test_commit, chain_id, idx)
      },
    )

  and {
    adjacent_validation.verify_commit_single(
      chain_id,
      validators(),
      test_commit,
      voting_power_needed,
      None,
    ) == verify_with_indexed_reference(
      validators(),
      test_commit,
      voting_power_needed,
      None,
    ),
    adjacent_validation.verify_commit_single(
      chain_id,
      validators(),
      test_commit,
      voting_power_needed,
      Some(sign_bytes),
    ) == verify_with_indexed_reference(
      validators(),
      test_commit,
      voting_power_needed,
      Some(sign_bytes),
    ),
  }
}

test linear_verifier_matches_indexed_reference() {
  expect [sig_0, sig_1, sig_2, sig_3] = commit_signatures()
  let absent = absent_signature()
  let nil_vote = CommitSig { ..sig_3, block_id_flag: 3 }
  // Validator addresses are not part of canonical vote sign bytes. The
  // existing adjacent path deliberately selects public keys by position.
  let mismatched_address =
    CommitSig {
      ..sig_3,
      validator_address: #"0000000000000000000000000000000000000000",
    }

  [
    [sig_0, sig_1, sig_2, sig_3],
    [absent, sig_1, sig_2, sig_3],
    [sig_0, absent, sig_2, sig_3],
    [sig_0, sig_1, absent, sig_3],
    [sig_0, sig_1, sig_2, absent],
    [absent, absent, sig_2, sig_3],
    [sig_0, sig_1, sig_2, nil_vote],
    [sig_0, sig_1, sig_2, mismatched_address],
    [absent, absent, absent, absent],
  ]
    |> list.all(verification_results_match)
}

test linear_verifier_rejects_an_extra_signature_slot() fail {
  expect [sig_0, sig_1, sig_2, sig_3] = commit_signatures()
  let test_commit = commit([sig_0, sig_1, sig_2, sig_3, sig_3])

  adjacent_validation.verify_commit_single(
    chain_id,
    validators(),
    test_commit,
    2,
    None,
  )
}

test linear_verifier_rejects_missing_precomputed_bytes_for_needed_vote() fail {
  let test_commit = commit(commit_signatures())

  adjacent_validation.verify_commit_single(
    chain_id,
    validators(),
    test_commit,
    2,
    Some([]),
  )
}

test linear_verifier_rejects_a_missing_signature_slot() fail {
  expect [sig_0, sig_1, sig_2, _sig_3] = commit_signatures()
  let test_commit = commit([sig_0, sig_1, sig_2])

  adjacent_validation.verify_commit_single(
    chain_id,
    validators(),
    test_commit,
    2,
    None,
  )
}

/// Scaling guard for the lockstep traversal. Repeating one valid validator and
/// signature isolates traversal cost; it is not a valid Tendermint set fixture.
test linear_verifier_handles_45_signature_slots() {
  expect [first_validator, ..] = validators()
  expect [first_signature, ..] = commit_signatures()
  let test_commit = commit(list.repeat(first_signature, 45))

  adjacent_validation.verify_commit_single(
    chain_id,
    list.repeat(first_validator, 45),
    test_commit,
    30,
    None,
  )
}
