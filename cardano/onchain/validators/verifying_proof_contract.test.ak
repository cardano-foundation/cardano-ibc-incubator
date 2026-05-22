use aiken/fuzz
use aiken/interval
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{Transaction, placeholder}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyMembershipParams,
  VerifyNonMembership, VerifyProofRedeemer,
}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, InnerOp, InnerSpec, LeafOp, NonExistenceProof, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/testing/fuzz_dsl
use verifying_proof

const proof_policy_id =
  #"2aa9c1557fcf8e7caa049fa0911a8724a1cdaf8037fe0b431c6ac663"

fn proof_marker_tx(policy_id: PolicyId) -> Transaction {
  Transaction {
    ..placeholder,
    mint: from_asset(policy_id, "", 1),
    validity_range: interval.after(0),
  }
}

fn proof_specs() -> List<ProofSpec> {
  [
    ProofSpec {
      leaf_spec: LeafOp {
        hash: 1,
        prehash_value: 1,
        length: 1,
        prefix: #"00",
        prehash_key: 0,
      },
      inner_spec: InnerSpec {
        child_order: [0, 1],
        child_size: 33,
        min_prefix_length: 4,
        max_prefix_length: 12,
        hash: 1,
        empty_child: #"",
      },
      max_depth: 0,
      min_depth: 0,
      prehash_key_before_comparison: False,
    },
    ProofSpec {
      leaf_spec: LeafOp {
        hash: 1,
        prehash_value: 1,
        length: 1,
        prefix: #"00",
        prehash_key: 0,
      },
      inner_spec: InnerSpec {
        child_order: [0, 1],
        child_size: 32,
        min_prefix_length: 1,
        max_prefix_length: 1,
        hash: 1,
        empty_child: #"",
      },
      max_depth: 0,
      min_depth: 0,
      prehash_key_before_comparison: False,
    },
  ]
}

fn client_state() -> ClientState {
  ClientState {
    chain_id: "testchain1-1",
    trust_level: UncheckedRational { numerator: 1, denominator: 3 },
    trusting_period: 1209600000000000,
    unbonding_period: 1814400000000000,
    max_clock_drift: 10000000000,
    frozen_height: Height { revision_number: 0, revision_height: 0 },
    latest_height: Height { revision_number: 1, revision_height: 13 },
    proof_specs: proof_specs(),
  }
}

fn proof_height() -> Height {
  Height { revision_number: 0, revision_height: 15 }
}

fn membership_packet() -> Packet {
  Packet {
    sequence: 1,
    source_port: "port-1",
    source_channel: "channel-0",
    destination_port: "port-1",
    destination_channel: "channel-0",
    data: "mock packet data",
    timeout_height: Height { revision_number: 0, revision_height: 0 },
    timeout_timestamp: 1735689600000000000,
  }
}

fn membership_consensus_state() -> ConsensusState {
  ConsensusState {
    timestamp: 1577923295000000000,
    next_validators_hash: #"7c3af87e2c224be7f3b2d7b2ab467e69b1a4ef5947fbe76d55e9091e16172346",
    root: MerkleRoot {
      hash: #"11a648b10463e8a96c77976940ee316117bb8214bd380e267aa31cf39ef8a09a",
    },
  }
}

fn membership_proof() -> MerkleProof {
  MerkleProof {
    proofs: [
      CommitmentProof {
        proof: CommitmentProof_Exist {
          exist: ExistenceProof {
            key: #"636f6d6d69746d656e74732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
            value: #"fa365cf5deedf3169bfe56010f101be23eac638d3bc9f43c7634f78ef718aa10",
            leaf: LeafOp {
              hash: 1,
              prehash_value: 1,
              length: 1,
              prefix: #"000224",
              prehash_key: 0,
            },
            path: [
              InnerOp {
                hash: 1,
                prefix: #"020424205fd25b3dc1314970dcbf74075f9d165af4a185eea459128edf21cfacc14b9c9e20",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"04062420",
                suffix: #"2067b76c7b82d60ebee7f41dd11a02534c1a16efa70c217310356230dfd5ad0c20",
              },
              InnerOp {
                hash: 1,
                prefix: #"060a2420",
                suffix: #"20f21e95601cbd0028a9c3c4effd8afbbe068f086ab152ec0edb9cde2fdd6c568f",
              },
              InnerOp {
                hash: 1,
                prefix: #"08162420",
                suffix: #"2038afa1cc8688eedde1256daab2bff7aade39a6db7320d62f47581fb65d9e8024",
              },
              InnerOp {
                hash: 1,
                prefix: #"0a2424203dd3101284b12a1c86ec48897aaf11781985de6f1eb75fdb6c8011a7d3e4d2ad20",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"0c462420617a9deebfac19d019bc9f7179c90ed228ee21d7330bc10568918f6f26cbb75320",
                suffix: #"",
              },
            ],
          },
        },
      },
      CommitmentProof {
        proof: CommitmentProof_Exist {
          exist: ExistenceProof {
            key: #"696263",
            value: #"6cfc3a7872f9703bcd5027ba7197890652bf545bd77a4ae7fa8b780746c91e42",
            leaf: LeafOp {
              hash: 1,
              prehash_value: 1,
              length: 1,
              prefix: #"00",
              prehash_key: 0,
            },
            path: [
              InnerOp {
                hash: 1,
                prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"01",
                suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
              },
              InnerOp {
                hash: 1,
                prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"01ef0d5a163ae333b43e2956b2d9660e65aaa9a1e2f90b30a91d97b5d0f12fb1fc",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"01",
                suffix: #"04634f3eedce1a4677cef6f418f7671437db345ad7e26581393b7cc6e722a2c7",
              },
            ],
          },
        },
      },
    ],
  }
}

fn membership_path(sequence: Int) -> MerklePath {
  merkle.apply_prefix(
    MerklePrefix { key_prefix: "ibc" },
    merkle.new_merkle_path(
      [packet_keys.packet_commitment_path("port-1", "channel-0", sequence)],
    ),
  )
}

fn valid_membership_params() -> VerifyMembershipParams {
  let packet = membership_packet()

  VerifyMembershipParams {
    cs: client_state(),
    cons_state: membership_consensus_state(),
    height: proof_height(),
    processed_time: 0,
    processed_height: 0,
    delay_time_period: 0,
    delay_block_period: 0,
    proof: membership_proof(),
    path: membership_path(packet.sequence),
    value: packet_mod.commit_packet(packet),
  }
}

fn membership_redeemer(item: VerifyMembershipParams) -> VerifyProofRedeemer {
  VerifyMembership {
    cs: item.cs,
    cons_state: item.cons_state,
    height: item.height,
    processed_time: item.processed_time,
    processed_height: item.processed_height,
    delay_time_period: item.delay_time_period,
    delay_block_period: item.delay_block_period,
    proof: item.proof,
    path: item.path,
    value: item.value,
  }
}

fn verify(redeemer: VerifyProofRedeemer) -> Bool {
  verifying_proof.verify_proof.mint(
    redeemer,
    proof_policy_id,
    proof_marker_tx(proof_policy_id),
  )
}

fn wrong_membership_path(item: VerifyMembershipParams) -> VerifyMembershipParams {
  VerifyMembershipParams { ..item, path: membership_path(2) }
}

fn wrong_membership_value(
  item: VerifyMembershipParams,
) -> VerifyMembershipParams {
  VerifyMembershipParams { ..item, value: #"00" }
}

fn wrong_membership_root(item: VerifyMembershipParams) -> VerifyMembershipParams {
  VerifyMembershipParams {
    ..item,
    cons_state: ConsensusState {
      ..item.cons_state,
      root: MerkleRoot {
        hash: #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    },
  }
}

fn nonmembership_consensus_state() -> ConsensusState {
  ConsensusState {
    timestamp: 1577923365000000000,
    next_validators_hash: #"020402703976bb4e91f05e69c25627e1b813bfeca54f4825afee49efe8acdbd7",
    root: MerkleRoot {
      hash: #"2a2a5880ec8d4d978eaace39e4d256a7d1dbd024f3c471aa8fa14a955d3eb102",
    },
  }
}

fn nonmembership_proof() -> MerkleProof {
  MerkleProof {
    proofs: [
      CommitmentProof {
        proof: CommitmentProof_Nonexist {
          non_exist: NonExistenceProof {
            key: #"72656365697074732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
            left: ExistenceProof {
              key: #"6e65787453657175656e636553656e642f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d30",
              value: #"0000000000000001",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00021a",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02041a2069fe4c2aa5110a8a5c97f267c34267d36f7ba2cf991cf3fd3624660aee2e746b20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04081a20ae5dc2363c0f0d1336872b4849c4e7a2041e3c3fec05c0337ab5cf34310a591820",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060c1a2094ccea99bc1c0dfeb3076d2e23d97768e40ce76732c03fef3e4d4294f86bab3e20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08142420408185c9c7a64d80e582a667d4c43c4c75f6f70b31973c1cc9566949f2ff4c4a20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  suffix: #"",
                  prefix: #"0a282420fe7b9f8701623b31b2cd0081bc29eeb8d8820342762d2291f99d0b87c45d2dad20",
                },
                InnerOp {
                  hash: 1,
                  suffix: #"",
                  prefix: #"0c4c242042ffb12ab52829ebe99314eb358efc1cb2c0c9bc351c26f1e8807cff1a0ab46d20",
                },
              ],
            },
            right: ExistenceProof {
              key: #"",
              value: #"",
              leaf: LeafOp {
                hash: 0,
                prehash_key: 0,
                prehash_value: 0,
                length: 0,
                prefix: #"",
              },
              path: [],
            },
          },
        },
      },
      CommitmentProof {
        proof: CommitmentProof_Exist {
          exist: ExistenceProof {
            key: #"696263",
            value: #"61ab6bc2f730e4b47b25ecbd63b19016dbbed90882db668aa9b904e4dc440b48",
            leaf: LeafOp {
              hash: 1,
              prehash_value: 1,
              length: 1,
              prefix: #"00",
              prehash_key: 0,
            },
            path: [
              InnerOp {
                hash: 1,
                prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"01",
                suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
              },
              InnerOp {
                hash: 1,
                prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"011ff6dd57644f3deb80dc6cf90b299a9d3b524446c6c939887fbe332ec5cf001a",
                suffix: #"",
              },
              InnerOp {
                hash: 1,
                prefix: #"01",
                suffix: #"1eac9a45c80ab2a8e4cf596213fe46583ee60b37ae47a49bb801d487f22cb301",
              },
            ],
          },
        },
      },
    ],
  }
}

fn receipt_path(sequence: Int) -> MerklePath {
  merkle.apply_prefix(
    MerklePrefix { key_prefix: "ibc" },
    merkle.new_merkle_path(
      [packet_keys.packet_receipt_path("port-1", "channel-0", sequence)],
    ),
  )
}

fn existing_left_neighbor_path() -> MerklePath {
  merkle.apply_prefix(
    MerklePrefix { key_prefix: "ibc" },
    merkle.new_merkle_path(["nextSequenceSend/ports/port-1/channels/channel-0"]),
  )
}

fn nonmembership_redeemer(path: MerklePath) -> VerifyProofRedeemer {
  VerifyNonMembership {
    cs: client_state(),
    cons_state: nonmembership_consensus_state(),
    height: proof_height(),
    processed_time: 0,
    processed_height: 0,
    delay_time_period: 0,
    delay_block_period: 0,
    proof: nonmembership_proof(),
    path,
  }
}

test prop_proof_membership_valid(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.proof.membership.valid")

  // Baseline membership proof for a packet commitment path. The negative cases
  // below mutate exactly one proof dimension from this fixture.
  fuzz_dsl.valid_check(
    "proof",
    "membership",
    "verify",
    valid_membership_params()
      |> membership_redeemer
      |> verify,
  )
    |> fuzz_dsl.assert_valid
}

test prop_proof_membership_rejects_wrong_path(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.membership.invalid_wrong_path")

  // Same proof/root/value, wrong Merkle path.
  valid_membership_params()
    |> wrong_membership_path
    |> membership_redeemer
    |> verify
}

test prop_proof_membership_rejects_wrong_value(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.membership.invalid_wrong_value")

  // Same path/root, wrong committed value.
  valid_membership_params()
    |> wrong_membership_value
    |> membership_redeemer
    |> verify
}

test prop_proof_membership_rejects_wrong_root(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.membership.invalid_wrong_root")

  // Same path/value, wrong consensus root.
  valid_membership_params()
    |> wrong_membership_root
    |> membership_redeemer
    |> verify
}

test prop_proof_batch_accepts_two_items(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.proof.batch.valid_two_items")

  // Batch verification must accept multiple valid membership items, not only a
  // single-item proof.
  let item = valid_membership_params()
  fuzz_dsl.valid_check(
    "proof",
    "batch",
    "verify",
    verify(BatchVerifyMembership([item, item])),
  )
    |> fuzz_dsl.assert_valid
}

test prop_proof_batch_rejects_swapped_item(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.batch.invalid_item_swapped")

  // One item is valid and one item is a different path. Batch verification
  // should fail the whole marker if any member proof is wrong.
  let item = valid_membership_params()
  let swapped = VerifyMembershipParams { ..item, path: membership_path(2) }
  verify(BatchVerifyMembership([item, swapped]))
}

test prop_proof_batch_rejects_extra_item(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.batch.invalid_extra_item")

  // Extra invalid proof material must not be ignored by list traversal.
  let item = valid_membership_params()
  verify(BatchVerifyMembership([item, wrong_membership_value(item)]))
}

test prop_proof_batch_rejects_missing_item(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.batch.invalid_missing_item")

  // Empty batch is not a successful proof; otherwise callers could mint a proof
  // marker without checking any key.
  verify(BatchVerifyMembership([]))
}

test prop_proof_nonmembership_valid(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.proof.nonmembership.valid")

  // Valid nonmembership proves no receipt exists for the packet path.
  fuzz_dsl.valid_check(
    "proof",
    "nonmembership",
    "verify",
    receipt_path(1)
      |> nonmembership_redeemer
      |> verify,
  )
    |> fuzz_dsl.assert_valid
}

test prop_proof_nonmembership_rejects_existing_key(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.contract.proof.nonmembership.invalid_existing_key")

  // If the queried key already exists as a neighbor, nonmembership must fail.
  existing_left_neighbor_path()
    |> nonmembership_redeemer
    |> verify
}
