use aiken/collection/pairs
use cardano/transaction.{
  Input, Mint, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{RecvPacket}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnRecvPacket, OtherModuleData,
}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/recv_packet
use spending_channel/spending_channel_fixture.{MockData, setup}

test succeed_recv_packet() {
  let mock_data = setup()

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: chan_state_mod.Open,
      ordering: chan_order_mod.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs = [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 19 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"7c3af87e2c224be7f3b2d7b2ab467e69b1a4ef5947fbe76d55e9091e16172346",
      root: MerkleRoot {
        hash: #"11a648b10463e8a96c77976940ee316117bb8214bd380e267aa31cf39ef8a09a",
      },
    }

  let client_input =
    test_utils.update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs = [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let ack = acknowledgement_mod.new_result_acknowledgement("AQ==")
  let bz_ack = acknowledgement_mod.acknowledgement(ack)
  let commit_ack = acknowledgement_mod.commit_acknowledgement(bz_ack)

  let packet =
    Packet {
      sequence: 1,
      source_port: input_channel.counterparty.port_id,
      source_channel: input_channel.counterparty.channel_id,
      destination_port: mock_data.port_id,
      destination_channel: channel_id,
      data: "mock packet data",
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1735689600000000000,
    }

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: [
          Pair(packet.sequence, ""),
          ..input_channel_datum.state.packet_receipt
        ],
        packet_acknowledgement: [
          Pair(packet.sequence, commit_ack),
          ..input_channel_datum.state.packet_acknowledgement
        ],
      },
    }

  let channel_output =
    test_utils.build_channel_output(
      output_channel_datum,
      mock_data.channel_token,
    )

  let outputs = [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_commitment =
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

  let spend_channel_redeemer: Redeemer =
    RecvPacket { packet, proof_commitment, proof_height }

  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket { channel_id, acknowledgement: ack, data: OtherModuleData },
    )

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)

  let client_datum_state = client_datum.state
  let connection = connection_datum.state

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            packet.source_port,
            packet.source_channel,
            packet.sequence,
          ),
        ],
      ),
    )
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let commitment = packet_mod.commit_packet(packet)

  let verify_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_commitment,
      path: merkle_path,
      value: commitment,
    }

  let recv_packet_redeemer: Redeemer = mock_data.channel_token

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Mint(mock_data.recv_packet_policy_id), recv_packet_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: inputs,
      reference_inputs: reference_inputs,
      outputs: outputs,
      redeemers: redeemers,
      validity_range: validity_range,
    }

  recv_packet.recv_packet.spend(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    None,
    mock_data.channel_token,
    channel_input.output_reference,
    transaction,
  )
}
