use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/state.{Open} as conn_state_mod
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty} as chan_counterparty_mod
use ibc/core/ics_004/types/order.{Ordered} as order_mod
use ibc/core/ics_004/types/state.{Init} as chan_state_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, InnerSpec,
  LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

test succeed_verify_channel_state() {
  let cons_state =
    ConsensusState {
      timestamp: 1577896895000000000,
      next_validators_hash: #"706a370e3b9e289654e5f10339974e39d3e10beaa2e2e3d2dddae2b275bdb4be",
      root: MerkleRoot {
        hash: #"d09daf0bab3256026bac71773ab4ed95e8336077989bc3cc29b6977e16fd2cc5",
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

  let connection =
    ConnectionEnd {
      client_id: "07-tendermint-0",
      versions: [
        Version {
          identifier: "1",
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
      ],
      state: Open,
      counterparty: Counterparty {
        client_id: "07-tendermint-0",
        connection_id: "connection-0",
        prefix: MerklePrefix { key_prefix: "ibc" },
      },
      delay_period: 0,
    }

  let channel =
    Channel {
      state: Init,
      ordering: Ordered,
      counterparty: ChannelCounterparty { port_id: "mock", channel_id: "" },
      connection_hops: ["connection-0"],
      version: "mock-version",
    }

  let proof =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"6368616e6e656c456e64732f706f7274732f6d6f636b2f6368616e6e656c732f6368616e6e656c2d30",
              value: #"080110021a060a046d6f636b220c636f6e6e656374696f6e2d302a0c6d6f636b2d76657273696f6e",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"000218",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02041820",
                  suffix: #"20072452876773f4e9b67456f4fd55fe48c9492aa788251556eab0975eb57ac2ca",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04061820",
                  suffix: #"20bdf12b6f8b72754e6ca2a9c2645fd67b10ad95c6d79a9184302258e536a099e8",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060e1820",
                  suffix: #"20f0370149d4a880c18f8e8932f2613780326cd6db32fe6952c62b0d19709501f7",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08161820",
                  suffix: #"20c312be55738d83b022cb1c60be2c37a36287271e1fd58cc247a0e02fc626ed79",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c341820",
                  suffix: #"200492e5301788acb841cf4ddb7d5f09151c6efbb9ba7ce73bbb2aa3bb0d97a9f0",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"198f34cd5b2705cb237661be9a5e6edc39241824c91d81b22134ac81e4cef90e",
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
                  prefix: #"017af3bb5073e602590882e190cdc73240e64fe01aac00d7e98b9f89b4cdc9d136",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"5fbcdbcdf769ae7b6b80124b9f42acdb0268d00b7cb5c9e89e4f68a2c5fb51e9",
                },
              ],
            },
          },
        },
      ],
    }

  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum_state =
    ClientDatumState {
      client_state,
      consensus_states: [Pair(proof_height, cons_state)]
    }

  verify_mod.verify_channel_state(
    client_datum_state,
    connection,
    "mock",
    "channel-0",
    proof,
    proof_height,
    channel,
  )
}
