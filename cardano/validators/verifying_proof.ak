use aiken/dict
use aiken/transaction.{Mint, ScriptContext}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/params
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_003_connection_semantics/verify_proof_redeemer.{
  VerifyChannelState, VerifyPacketAcknowledgement, VerifyPacketCommitment,
  VerifyPacketReceiptAbsence, VerifyProofRedeemer,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, InnerOp, InnerSpec, LeafOp, NonExistenceProof, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/math

validator {
  fn verify_proof(redeemer: VerifyProofRedeemer, _context: Data) -> Bool {
    when redeemer is {
      VerifyChannelState {
        client_datum_state,
        connection,
        port_id,
        channel_id,
        proof,
        proof_height,
        channel,
      } -> {
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [channel_keys.channel_path(port_id, channel_id)],
            ),
          )
        expect Some(consensus_state) =
          dict.from_list(
            client_datum_state.consensus_states,
            height_mod.compare,
          )
            |> dict.get(proof_height)
        client_state.verify_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          0,
          0,
          proof,
          merkle_path,
          channel_pb.marshal_for_channel(
            Some(channel.convert_to_channel_proto(channel)),
          ),
        )
      }

      VerifyPacketCommitment {
        client_datum_state,
        connection,
        proof_height,
        proof,
        port_id,
        channel_id,
        sequence,
        commitment_bytes,
      } -> {
        let time_delay = connection.delay_period
        let block_delay = get_block_delay(connection)
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [
                packet_keys.packet_commitment_path(
                  port_id,
                  channel_id,
                  sequence,
                ),
              ],
            ),
          )
        expect Some(consensus_state) =
          dict.from_list(
            client_datum_state.consensus_states,
            height_mod.compare,
          )
            |> dict.get(proof_height)
        client_state.verify_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          time_delay,
          block_delay,
          proof,
          merkle_path,
          commitment_bytes,
        )
      }

      VerifyPacketAcknowledgement {
        client_datum_state,
        connection,
        proof_height,
        proof,
        port_id,
        channel_id,
        sequence,
        acknowledgement,
      } -> {
        let time_delay = connection.delay_period
        let block_delay = get_block_delay(connection)
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [
                packet_keys.packet_acknowledgement_path(
                  port_id,
                  channel_id,
                  sequence,
                ),
              ],
            ),
          )

        expect Some(consensus_state) =
          dict.from_list(
            client_datum_state.consensus_states,
            height_mod.compare,
          )
            |> dict.get(proof_height)

        let commit_ack =
          acknowledgement_mod.commit_acknowledgement(acknowledgement)

        client_state.verify_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          time_delay,
          block_delay,
          proof,
          merkle_path,
          commit_ack,
        )
      }

      VerifyPacketReceiptAbsence {
        client_datum_state,
        connection,
        proof_height,
        proof,
        port_id,
        channel_id,
        sequence,
      } -> {
        let time_delay = connection.delay_period
        let block_delay = get_block_delay(connection)
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [packet_keys.packet_receipt_path(port_id, channel_id, sequence)],
            ),
          )
        expect Some(consensus_state) =
          dict.from_list(
            client_datum_state.consensus_states,
            height_mod.compare,
          )
            |> dict.get(proof_height)
        client_state.verify_non_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          time_delay,
          block_delay,
          proof,
          merkle_path,
        )
      }

      _ -> False
    }
  }
}

fn get_block_delay(connection: ConnectionEnd) -> Int {
  let expected_time_per_block = params.max_expected_time_per_block
  let time_delay = connection.delay_period
  math.ceil_divide_uinteger(time_delay, expected_time_per_block)
}

//==========================================Test================================================

pub type MockData {
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  port_id: ByteArray,
  channel_id: ByteArray,
  proof_height: Height,
}

fn setup() -> MockData {
  //========================Client==============================

  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"be42d79cf15375efd54cf594c9f016db8c8b8dc4e91f35f11bba000ec7e9f439",
      root: MerkleRoot {
        hash: #"3d89dd39e1f1c7a0cec08f3ebf31fcb485f42068fcb79a8aeb3a9ca9f4e7091d",
      },
    }

  let trust_level = unchecked_rational.new(1, 3)

  let proof_specs =
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

  let client_state =
    ClientState {
      chain_id: "testchain1-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: Height { revision_number: 1, revision_height: 13 },
      proof_specs,
    }

  let init_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum_state =
    ClientDatumState {
      client_state,
      consensus_states: dict.new()
        |> dict.insert(init_height, cons_state, height_mod.compare)
        |> dict.to_list(),
    }

  //========================Connection==============================
  let connection =
    ConnectionEnd {
      client_id: "ibc_client-10",
      versions: [
        Version {
          identifier: "1",
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
      ],
      state: conn_state_mod.Open,
      counterparty: Counterparty {
        client_id: "07-tendermint-0",
        connection_id: "connection-0",
        prefix: MerklePrefix { key_prefix: "ibc" },
      },
      delay_period: 0,
    }

  let proof_height = Height { revision_number: 0, revision_height: 15 }

  MockData {
    client_datum_state,
    connection,
    port_id: "port-1",
    channel_id: "channel-0",
    proof_height,
  }
}

fn insert_proof_cons_state(
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof_cons_state: ConsensusState,
) -> ClientDatumState {
  let updated_cons_states =
    dict.from_list(client_datum_state.consensus_states, height_mod.compare)
      |> dict.insert(proof_height, proof_cons_state, height_mod.compare)
      |> dict.to_list()

  ClientDatumState {
    ..client_datum_state,
    consensus_states: updated_cons_states,
  }
}

test verify_packet_absence_succeed() {
  let mock = setup()

  let proof_cons_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"020402703976bb4e91f05e69c25627e1b813bfeca54f4825afee49efe8acdbd7",
      root: MerkleRoot {
        hash: #"2a2a5880ec8d4d978eaace39e4d256a7d1dbd024f3c471aa8fa14a955d3eb102",
      },
    }

  let client_datum_state =
    insert_proof_cons_state(
      mock.client_datum_state,
      mock.proof_height,
      proof_cons_state,
    )

  let proof_unreceived =
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

  //========================arrange redeemer=======================
  let redeemer =
    VerifyPacketReceiptAbsence {
      client_datum_state,
      connection: mock.connection,
      proof_height: mock.proof_height,
      proof: proof_unreceived,
      port_id: mock.port_id,
      channel_id: mock.channel_id,
      sequence: 1,
    }

  //========================arrange context=======================
  let context =
    ScriptContext { purpose: Mint(""), transaction: transaction.placeholder() }

  verify_proof(redeemer, context)
}
