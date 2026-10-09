use aiken/collection/list
use aiken/interval
use aiken/primitive/bytearray
use cardano/address
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  UpgradeClient, UpgradeClientWithdrawal,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/upgrade_pb
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyClientUpgrade, VerifyProofEnvelope,
}
use ibc/client/ics_007_tendermint_client/upgrade.{Upgrade}
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment as tree
use recover_client
use verifying_proof

const now = 101_000_000_000

fn proposed() -> ClientState {
  ClientState {
    chain_id: "chain-1",
    trust_level: UncheckedRational { numerator: 1, denominator: 3 },
    trusting_period: 10_000_000_000,
    unbonding_period: 20_000_000_000,
    max_clock_drift: 1_000_000_000,
    frozen_height: height.zero_height(),
    latest_height: Height { revision_number: 1, revision_height: 1 },
    proof_specs: [proofs.iavl_spec(), proofs.tendermint_spec()],
    upgrade_path: ["upgrade", "upgradedIBCState"],
  }
}

fn kernel() -> ConsensusState {
  ConsensusState {
    timestamp: 100_000_000_123,
    next_validators_hash: #"0000000000000000000000000000000000000000000000000000000000000000",
    root: MerkleRoot { hash: "" },
  }
}

fn leaf(key: ByteArray, value: ByteArray) -> ExistenceProof {
  ExistenceProof {
    key,
    value,
    leaf: LeafOp { ..proofs.iavl_spec().leaf_spec, prefix: #"000202" },
    path: [],
  }
}

fn merkle_proof(exist: ExistenceProof) -> MerkleProof {
  let upper =
    ExistenceProof {
      key: "upgrade",
      value: proof.calculate_exist(exist),
      leaf: proofs.tendermint_spec().leaf_spec,
      path: [],
    }
  MerkleProof {
    proofs: [
      CommitmentProof { proof: CommitmentProof_Exist { exist } },
      CommitmentProof { proof: CommitmentProof_Exist { exist: upper } },
    ],
  }
}

fn fixture_for(next: ClientState) -> (ClientDatum, ClientDatum, Upgrade) {
  let client_leaf =
    leaf("upgradedIBCState/100/upgradedClient", upgrade_pb.client(next))
  let consensus_leaf =
    leaf(
      "upgradedIBCState/100/upgradedConsState",
      upgrade_pb.consensus(kernel()),
    )
  let client_proof =
    ExistenceProof {
      ..client_leaf,
      path: [
        InnerOp {
          hash: 1,
          prefix: #"02040220",
          suffix: bytearray.concat(#"20", proof.calculate_exist(consensus_leaf)),
        },
      ],
    }
  let consensus_proof =
    ExistenceProof {
      ..consensus_leaf,
      path: [
        InnerOp {
          hash: 1,
          prefix: bytearray.concat(
            #"02040220",
            bytearray.concat(proof.calculate_exist(client_leaf), #"20"),
          ),
          suffix: "",
        },
      ],
    }
  let old_height = Height { revision_number: 0, revision_height: 100 }
  let old =
    ClientState { ..proposed(), chain_id: "chain-0", latest_height: old_height }
  let before =
    ClientDatum {
      token: AuthToken { policy_id: "client-policy", name: "client-0" },
      history_root: "history",
      state: ClientDatumState {
        client_state: old,
        consensus_states: [
          Pair(
            old_height,
            ConsensusState {
              ..kernel(),
              root: MerkleRoot {
                hash: proof.calculate_exist(
                  ExistenceProof {
                    key: "upgrade",
                    value: proof.calculate_exist(client_proof),
                    leaf: proofs.tendermint_spec().leaf_spec,
                    path: [],
                  },
                ),
              },
            },
          ),
        ],
        processed_times: [Pair(old_height, now)],
        processed_heights: [Pair(old_height, 1)],
      },
    }
  let after =
    ClientDatum {
      ..before,
      state: ClientDatumState {
        client_state: next,
        consensus_states: [
          Pair(
            next.latest_height,
            ConsensusState {
              ..kernel(),
              root: MerkleRoot { hash: "sentinel_root" },
            },
          ),
        ],
        processed_times: [Pair(next.latest_height, now)],
        processed_heights: [
          Pair(next.latest_height, client_datum.processed_height_from_time(now)),
        ],
      },
    }
  (
    before,
    after,
    Upgrade {
      client_state: next,
      consensus_state: kernel(),
      proof_client: merkle_proof(client_proof),
      proof_consensus: merkle_proof(consensus_proof),
      history_siblings: [],
    },
  )
}

test upgrade_revision_can_reset_height() {
  let (before, after, u) = fixture_for(proposed())
  upgrade.verify(before, after, u, now)
}

test upgrade_same_revision_can_advance_height() {
  let next =
    ClientState {
      ..proposed(),
      chain_id: "chain-0",
      latest_height: Height { revision_number: 0, revision_height: 101 },
    }
  let (before, after, u) = fixture_for(next)
  upgrade.verify(before, after, u, now)
}

test upgrade_rejects_rollback_even_with_valid_proofs() fail {
  let next =
    ClientState {
      ..proposed(),
      chain_id: "chain-0",
      latest_height: Height { revision_number: 0, revision_height: 99 },
    }
  let (before, after, u) = fixture_for(next)
  expect upgrade.verify(before, after, u, now)
}

test upgrade_ignores_submitter_trust_settings() {
  let (before, after, u) = fixture_for(proposed())
  let malicious =
    ClientState {
      ..u.client_state,
      trusting_period: 999999999999999,
      trust_level: UncheckedRational { numerator: 0, denominator: 0 },
      max_clock_drift: 0,
      frozen_height: Height { revision_number: 0, revision_height: 1 },
    }
  upgrade.verify(before, after, Upgrade { ..u, client_state: malicious }, now)
}

test upgrade_cannot_change_output_trust_settings() fail {
  let (before, after, u) = fixture_for(proposed())
  let altered =
    ClientDatum {
      ..after,
      state: ClientDatumState {
        ..after.state,
        client_state: ClientState {
          ..after.state.client_state,
          trusting_period: 15_000_000_000,
        },
      },
    }
  expect upgrade.verify(before, altered, u, now)
}

test upgrade_rejects_forged_chain_id() fail {
  let (before, after, u) = fixture_for(proposed())
  expect
    upgrade.verify(
      before,
      after,
      Upgrade {
        ..u,
        client_state: ClientState { ..u.client_state, chain_id: "evil-1" },
      },
      now,
    )
}

test upgrade_rejects_forged_consensus_state() fail {
  let (before, after, u) = fixture_for(proposed())
  expect
    upgrade.verify(
      before,
      after,
      Upgrade {
        ..u,
        consensus_state: ConsensusState {
          ..kernel(),
          timestamp: 100_000_000_124,
        },
      },
      now,
    )
}

test upgrade_rejects_swapped_proofs() fail {
  let (before, after, u) = fixture_for(proposed())
  expect
    upgrade.verify(
      before,
      after,
      Upgrade {
        ..u,
        proof_client: u.proof_consensus,
        proof_consensus: u.proof_client,
      },
      now,
    )
}

test upgrade_rejects_wrong_old_path() fail {
  let (before, after, u) = fixture_for(proposed())
  let altered =
    ClientDatum {
      ..before,
      state: ClientDatumState {
        ..before.state,
        client_state: ClientState {
          ..before.state.client_state,
          upgrade_path: ["upgrade", "evil"],
        },
      },
    }
  expect upgrade.verify(altered, after, u, now)
}

test upgrade_rejects_disabled_path() fail {
  let (before, after, u) = fixture_for(proposed())
  let altered =
    ClientDatum {
      ..before,
      state: ClientDatumState {
        ..before.state,
        client_state: ClientState {
          ..before.state.client_state,
          upgrade_path: [],
        },
      },
    }
  expect upgrade.verify(altered, after, u, now)
}

test upgrade_rejects_frozen_client() fail {
  let (before, after, u) = fixture_for(proposed())
  let altered =
    ClientDatum {
      ..before,
      state: ClientDatumState {
        ..before.state,
        client_state: ClientState {
          ..before.state.client_state,
          frozen_height: Height { revision_number: 0, revision_height: 1 },
        },
      },
    }
  expect upgrade.verify(altered, after, u, now)
}

test upgrade_rejects_expired_client() fail {
  let (before, after, u) = fixture_for(proposed())
  expect upgrade.verify(before, after, u, 110_000_000_123)
}

test upgrade_rejects_short_unbonding_period() fail {
  let (before, after, u) =
    fixture_for(ClientState { ..proposed(), unbonding_period: 9_000_000_000 })
  expect upgrade.verify(before, after, u, now)
}

test upgrade_bootstrap_cannot_verify_membership() fail {
  let (_, after, u) = fixture_for(proposed())
  expect [Pair(h, consensus)] = after.state.consensus_states
  expect
    client_state.verify_membership(
      after.state.client_state,
      consensus,
      h,
      0,
      0,
      now,
      0,
      0,
      0,
      u.proof_client,
      MerklePath { key_path: ["anything"] },
      "anything",
    )
}

test upgrade_bootstrap_cannot_verify_nonmembership() fail {
  let (_, after, u) = fixture_for(proposed())
  expect [Pair(h, consensus)] = after.state.consensus_states
  expect
    client_state.verify_non_membership(
      after.state.client_state,
      consensus,
      h,
      0,
      0,
      now,
      0,
      0,
      0,
      u.proof_client,
      MerklePath { key_path: ["anything"] },
    )
}

test upgrade_path_preserves_store_segments_and_old_height() {
  upgrade.path(["upgrade", "upgradedIBCState"], 100, "upgradedClient") == [
    "upgrade", "upgradedIBCState/100/upgradedClient",
  ]
}

// Golden protobuf Any bytes generated with ibc-go v8.7.0 ZeroCustomFields().
// Empty non-nullable gogo fields are intentional and are part of the commitment.
test upgrade_protobuf_matches_ibc_go() {
  and {
    upgrade_pb.client(proposed()) == #"0a2b2f6962632e6c69676874636c69656e74732e74656e6465726d696e742e76312e436c69656e745374617465126c0a07636861696e2d3112001a00220208142a0032003a040801100142190a090801180120012a0100120c0a02000110211804200c300142190a090801180120012a0100120c0a02000110201801200130014a07757067726164654a1075706772616465644942435374617465",
    upgrade_pb.client(
      ClientState {
        ..proposed(),
        proof_specs: [proofs.tendermint_spec()],
        upgrade_path: ["upgradedIBCState"],
      },
    ) == #"0a2b2f6962632e6c69676874636c69656e74732e74656e6465726d696e742e76312e436c69656e74537461746512480a07636861696e2d3112001a00220208142a0032003a040801100142190a090801180120012a0100120c0a02000110201801200130014a1075706772616465644942435374617465",
    upgrade_pb.consensus(kernel()) == #"0a2e2f6962632e6c69676874636c69656e74732e74656e6465726d696e742e76312e436f6e73656e7375735374617465122a0a040864107b12001a200000000000000000000000000000000000000000000000000000000000000000",
  }
}

fn transaction_fixture() -> (Transaction, VerifyProofEnvelope) {
  let (old, next, u) = fixture_for(proposed())
  let before = ClientDatum { ..old, history_root: tree.empty_hash }
  let siblings = list.repeat(tree.empty_hash, tree.merkle_depth_bits)
  let after =
    ClientDatum {
      ..next,
      history_root: consensus_history.insert(
        before.history_root,
        consensus_history.from_client(before),
        siblings,
      ),
    }
  let envelope =
    VerifyProofEnvelope {
      proof: VerifyClientUpgrade {
        input: before,
        output: after,
        upgrade: Upgrade { ..u, history_siblings: siblings },
      },
      history_witness: None,
    }
  let reference =
    OutputReference { transaction_id: "transaction", output_index: 0 }
  let output =
    Output {
      address: address.from_script("client"),
      value: assets.from_asset(before.token.policy_id, before.token.name, 1),
      datum: InlineDatum(before),
      reference_script: None,
    }
  let raw_spend: Data = UpgradeClient
  let raw_proof: Data = envelope
  (
    Transaction {
      ..transaction.placeholder,
      inputs: [Input { output_reference: reference, output }],
      outputs: [Output { ..output, datum: InlineDatum(after) }],
      mint: assets.from_asset("proof", "", 1),
      validity_range: interval.between(now / 1_000_000 - 1000, now / 1_000_000),
      redeemers: [
        Pair(Spend(reference), raw_spend),
        Pair(Mint("proof"), raw_proof),
      ],
    },
    envelope,
  )
}

test upgrade_proof_policy_checks_history_and_both_proofs() {
  let (tx, envelope) = transaction_fixture()
  verifying_proof.verify_proof.mint(envelope, "proof", tx)
}

test upgrade_withdrawal_binds_exact_spent_and_created_datums() {
  let (tx, _) = transaction_fixture()
  let (before, _, _) = fixture_for(proposed())
  recover_client.recover_client.withdraw(
    "host",
    "proof",
    UpgradeClientWithdrawal { subject_token: before.token },
    address.Script("recovery"),
    tx,
  )
}

test upgrade_withdrawal_rejects_another_proof_policy() fail {
  let (tx, _) = transaction_fixture()
  let (before, _, _) = fixture_for(proposed())
  expect
    recover_client.recover_client.withdraw(
      "host",
      "fake-proof",
      UpgradeClientWithdrawal { subject_token: before.token },
      address.Script("recovery"),
      tx,
    )
}

test upgrade_withdrawal_rejects_output_substitution() fail {
  let (tx, _) = transaction_fixture()
  let (before, after, _) = fixture_for(proposed())
  expect [output] = tx.outputs
  let forged =
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(ClientDatum { ..after, history_root: "forged" }),
        },
      ],
    }
  expect
    recover_client.recover_client.withdraw(
      "host",
      "proof",
      UpgradeClientWithdrawal { subject_token: before.token },
      address.Script("recovery"),
      forged,
    )
}
