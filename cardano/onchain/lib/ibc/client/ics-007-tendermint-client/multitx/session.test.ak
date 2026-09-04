use aiken/collection/list
use cardano/transaction.{OutputReference}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader}
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator} as tm_validator
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/multitx/rfc6962_membership
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  CommitCore, SessionDatum, TargetEntry, TrustedMembership, UpdatePlan,
  VerifyTarget, VerifyTrusted, max_total_voting_power,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle
use ibc/utils/tx_time.{TxTime}

const validator_root =
  #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1"

fn client_token() -> AuthToken {
  AuthToken {
    policy_id: #"11111111111111111111111111111111111111111111111111111111",
    name: "08-tendermint-0",
  }
}

fn session_token() -> AuthToken {
  AuthToken {
    policy_id: #"22222222222222222222222222222222222222222222222222222222",
    name: #"3333333333333333333333333333333333333333333333333333333333333333",
  }
}

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

fn target_header() -> TmHeader {
  TmHeader {
    version: Consensus { block: block_protocol, app: 2 },
    chain_id: "testchain2-1",
    height: 3,
    time: 1577836805000000000,
    last_block_id: BlockID {
      hash: #"0000000000000000000000000000000000000000000000000000000000000000",
      part_set_header: PartSetHeader {
        total: 10000,
        hash: #"0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    last_commit_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
    data_hash: #"6d6e28b8b98b5327042ea50a57dd46e6cc851c72e528bdeaa6efdeeefe66a0b8",
    validators_hash: validator_root,
    next_validators_hash: validator_root,
    consensus_hash: #"e5e566c41ed57e3ff8cc10f184178788b8faa602b07cf1f425217bd8179f1f24",
    app_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
    last_results_hash: #"092e058630247ed6009863a12eee117d26cd9d08b5adcaab37f2ab35db475a37",
    evidence_hash: #"73865db08f49d58428905d389ab4ca4b96e45a3206c7a69d43a5dc7372e60714",
    proposer_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
  }
}

fn commit_core() -> CommitCore {
  CommitCore {
    height: 3,
    round: 1,
    block_id: BlockID {
      hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
      part_set_header: PartSetHeader {
        total: 3,
        hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
      },
    },
  }
}

fn trusted_consensus_state() -> ConsensusState {
  ConsensusState {
    timestamp: 1577836800000000000,
    next_validators_hash: validator_root,
    root: merkle.new_merkle_root(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
  }
}

fn plan(trusted_revision_height: Int) -> UpdatePlan {
  UpdatePlan {
    client_token: client_token(),
    trusted_height: Height {
      revision_number: 1,
      revision_height: trusted_revision_height,
    },
    trusted_consensus_state: trusted_consensus_state(),
    trust_level: unchecked_rational.new(1, 3),
    trusting_period: 1_209_600_000_000_000,
    max_clock_drift: 10_000_000_000,
    header: target_header(),
    commit: commit_core(),
    target_validator_count: 4,
    trusted_validator_count: if trusted_revision_height == 2 {
      0
    } else {
      4
    },
  }
}

// Compact, deliberately non-semantic fixture shared with the Gateway codec
// test. Hashing commits to its Plutus Data encoding; plan validation is not
// involved in this cross-language vector.
fn hash_vector_plan() -> UpdatePlan {
  UpdatePlan {
    client_token: AuthToken { policy_id: #"01", name: #"02" },
    trusted_height: Height { revision_number: 3, revision_height: 4 },
    trusted_consensus_state: ConsensusState {
      timestamp: 5,
      next_validators_hash: #"06",
      root: merkle.new_merkle_root(#"07"),
    },
    trust_level: unchecked_rational.new(8, 9),
    trusting_period: 10,
    max_clock_drift: 11,
    header: TmHeader {
      version: Consensus { block: 12, app: 13 },
      chain_id: #"14",
      height: 15,
      time: 16,
      last_block_id: BlockID {
        hash: #"17",
        part_set_header: PartSetHeader { total: 18, hash: #"19" },
      },
      last_commit_hash: #"1a",
      data_hash: #"1b",
      validators_hash: #"1c",
      next_validators_hash: #"1d",
      consensus_hash: #"1e",
      app_hash: #"1f",
      last_results_hash: #"20",
      evidence_hash: #"21",
      proposer_address: #"22",
    },
    commit: CommitCore {
      height: 23,
      round: 24,
      block_id: BlockID {
        hash: #"25",
        part_set_header: PartSetHeader { total: 26, hash: #"27" },
      },
    },
    target_validator_count: 28,
    trusted_validator_count: 29,
  }
}

fn validator_bytes() -> List<ByteArray> {
  validators() |> list.map(tm_validator.bytes)
}

fn audit_path(items: List<ByteArray>, index: Int) -> List<ByteArray> {
  let count = list.length(items)
  if count == 1 {
    []
  } else {
    let split = rfc6962_membership.split_point(count)
    let (left, right) = list.span(items, split)
    if index < split {
      [tree.hash_from_byte_slices_sha2_256(right), ..audit_path(left, index)]
    } else {
      [
        tree.hash_from_byte_slices_sha2_256(left),
        ..audit_path(right, index - split)
      ]
    }
  }
}

fn entries(
  tm_vals: List<Validator>,
  signatures: List<CommitSig>,
  include_membership: Bool,
  index: Int,
) -> List<TargetEntry> {
  when tm_vals is {
    [] -> {
      expect signatures == []
      []
    }
    [tm_val, ..rest] -> {
      expect [signature, ..rest_signatures] = signatures
      let trusted_membership =
        if include_membership && index < 2 {
          Some(
            TrustedMembership {
              index,
              trusted_validator: tm_val,
              audit_path: audit_path(validator_bytes(), index),
            },
          )
        } else {
          None
        }
      [
        TargetEntry {
          target_validator: tm_val,
          commit_sig: signature,
          trusted_membership,
        },
        ..entries(rest, rest_signatures, include_membership, index + 1)
      ]
    }
  }
}

fn adjacent_entries() -> List<TargetEntry> {
  entries(validators(), commit_signatures(), False, 0)
}

fn non_adjacent_entries() -> List<TargetEntry> {
  entries(validators(), commit_signatures(), True, 0)
}

fn completed_adjacent() -> SessionDatum {
  session.advance(
    session.initial_datum(
      session_token(),
      #"44444444444444444444444444444444444444444444444444444444",
      plan(2),
    ),
    VerifyTarget { entries: adjacent_entries() },
  )
}

fn completed_non_adjacent() -> SessionDatum {
  let initial =
    session.initial_datum(
      session_token(),
      #"44444444444444444444444444444444444444444444444444444444",
      plan(1),
    )
  let target_phase =
    session.advance(initial, VerifyTrusted { validators: validators() })
  session.advance(
    target_phase,
    VerifyTarget { entries: non_adjacent_entries() },
  )
}

fn live_client() -> ClientDatum {
  let trusted_height = Height { revision_number: 1, revision_height: 2 }
  ClientDatum {
    token: client_token(),
    state: ClientDatumState {
      client_state: ClientState {
        chain_id: "testchain2-1",
        trust_level: unchecked_rational.new(1, 3),
        trusting_period: 1_209_600_000_000_000,
        unbonding_period: 1_814_400_000_000_000,
        max_clock_drift: 10_000_000_000,
        frozen_height: Height { revision_number: 0, revision_height: 0 },
        latest_height: trusted_height,
        proof_specs: [],
      },
      consensus_states: [Pair(trusted_height, trusted_consensus_state())],
      processed_times: [Pair(trusted_height, 0)],
      processed_heights: [Pair(trusted_height, 0)],
    },
  }
}

fn live_client_with_older_trusted_height(latest_timestamp: Int) -> ClientDatum {
  let trusted_height = Height { revision_number: 1, revision_height: 1 }
  let latest_height = Height { revision_number: 1, revision_height: 2 }
  let latest_consensus_state =
    ConsensusState { ..trusted_consensus_state(), timestamp: latest_timestamp }
  let client = live_client()
  ClientDatum {
    ..client,
    state: ClientDatumState {
      client_state: ClientState { ..client.state.client_state, latest_height },
      consensus_states: [
        Pair(latest_height, latest_consensus_state),
        Pair(trusted_height, trusted_consensus_state()),
      ],
      processed_times: [Pair(latest_height, 0), Pair(trusted_height, 0)],
      processed_heights: [Pair(latest_height, 0), Pair(trusted_height, 0)],
    },
  }
}

test real_adjacent_commit_reaches_complete() {
  completed_adjacent() |> session.is_complete_valid
}

test real_non_adjacent_commit_and_memberships_reach_complete() {
  completed_non_adjacent() |> session.is_complete_valid
}

test finalization_binds_live_client_and_time() {
  session.validate_finalization(
    completed_adjacent(),
    live_client(),
    TxTime { valid_from: 1577836804000000000, valid_to: 1577836806000000000 },
  )
}

test finalization_rejects_changed_client_parameters() {
  let client = live_client()
  let changed =
    ClientDatum {
      ..client,
      state: ClientDatumState {
        ..client.state,
        client_state: ClientState {
          ..client.state.client_state,
          max_clock_drift: client.state.client_state.max_clock_drift + 1,
        },
      },
    }
  !session.validate_finalization(
    completed_adjacent(),
    changed,
    TxTime { valid_from: 1577836804000000000, valid_to: 1577836806000000000 },
  )
}

test finalization_accepts_target_time_after_live_latest_consensus_time() {
  session.validate_finalization(
    completed_non_adjacent(),
    live_client_with_older_trusted_height(target_header().time - 1),
    TxTime { valid_from: 1577836804000000000, valid_to: 1577836806000000000 },
  )
}

test finalization_rejects_target_time_not_after_live_latest_consensus_time() {
  !session.validate_finalization(
    completed_non_adjacent(),
    live_client_with_older_trusted_height(target_header().time),
    TxTime { valid_from: 1577836804000000000, valid_to: 1577836806000000000 },
  )
}

test session_token_name_binds_seed_and_plan() {
  let seed_a =
    OutputReference {
      transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      output_index: 0,
    }
  let seed_b = OutputReference { ..seed_a, output_index: 1 }
  let name = session.session_token_name(seed_a, plan(2))
  and {
    name == session.session_token_name(seed_a, plan(2)),
    name != session.session_token_name(seed_b, plan(2)),
    name != session.session_token_name(seed_a, plan(1)),
  }
}

test plan_hash_and_session_token_name_match_gateway_vectors() {
  let seed = OutputReference { transaction_id: #"91", output_index: 2 }
  and {
    session.plan_hash(hash_vector_plan()) == #"3f6916cc37bb1320545493e5a55e46f7dd915085fe77859cef7c37e42922d405",
    session.session_token_name(seed, hash_vector_plan()) == #"2c868d761c5aac27a22e841f285a6e386eadc89ece0d37df84836ac8cb6daae9",
  }
}

test zero_voting_power_is_invalid() {
  expect Some(first) = list.at(validators(), 0)
  !session.validate_validator(Validator { ..first, voting_power: 0 })
}

test duplicate_target_entry_is_rejected() fail {
  expect Some(first) = list.at(validators(), 0)
  let entry =
    TargetEntry {
      target_validator: first,
      commit_sig: absent_signature(),
      trusted_membership: None,
    }
  session.advance(
    session.initial_datum(
      session_token(),
      #"44444444444444444444444444444444444444444444444444444444",
      plan(2),
    ),
    VerifyTarget { entries: [entry, entry] },
  ) == completed_adjacent()
}

test canonical_order_is_enforced_across_batches() fail {
  expect Some(first) = list.at(validators(), 0)
  expect Some(second) = list.at(validators(), 1)
  let first_entry =
    TargetEntry {
      target_validator: second,
      commit_sig: absent_signature(),
      trusted_membership: None,
    }
  let out_of_order =
    TargetEntry {
      target_validator: first,
      commit_sig: absent_signature(),
      trusted_membership: None,
    }
  let after_first =
    session.advance(
      session.initial_datum(
        session_token(),
        #"44444444444444444444444444444444444444444444444444444444",
        plan(2),
      ),
      VerifyTarget { entries: [first_entry] },
    )
  session.advance(after_first, VerifyTarget { entries: [out_of_order] }) == completed_adjacent()
}

test batch_larger_than_six_is_rejected() fail {
  expect Some(first) = list.at(validators(), 0)
  let entry =
    TargetEntry {
      target_validator: first,
      commit_sig: absent_signature(),
      trusted_membership: None,
    }
  session.advance(
    session.initial_datum(
      session_token(),
      #"44444444444444444444444444444444444444444444444444444444",
      UpdatePlan { ..plan(2), target_validator_count: 7 },
    ),
    VerifyTarget { entries: [entry, entry, entry, entry, entry, entry, entry] },
  ) == completed_adjacent()
}

test total_voting_power_above_cometbft_limit_is_rejected() fail {
  expect Some(first) = list.at(validators(), 0)
  let oversized =
    Validator { ..first, voting_power: max_total_voting_power + 1 }
  session.advance(
    session.initial_datum(
      session_token(),
      #"44444444444444444444444444444444444444444444444444444444",
      plan(2),
    ),
    VerifyTarget {
      entries: [
        TargetEntry {
          target_validator: oversized,
          commit_sig: absent_signature(),
          trusted_membership: None,
        },
      ],
    },
  ) == completed_adjacent()
}
