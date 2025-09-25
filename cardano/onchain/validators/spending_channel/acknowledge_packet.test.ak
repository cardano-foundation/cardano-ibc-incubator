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
use ibc/core/ics_004/channel_redeemer.{AcknowledgePacket}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket, OtherModuleData,
}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/acknowledge_packet
use spending_channel/spending_channel_fixture.{MockData, setup}

test succeed_acknowledge_packet() {
  let mock_data = setup()

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: Height { revision_number: 1, revision_height: 100 },
      timeout_timestamp: 0,
    }

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

  let input_channel_datum = test_utils.send_packet(packet, input_channel_datum)

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs = [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 20 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"2995675ed1313a1c80f6f4444ffc859bb9f00f71b75d6ca23481ca8d70691907",
      root: MerkleRoot {
        hash: #"b06efe83ef60f9b969917fa26c392eec29cdbfb6e6d11007c57856a412ff0997",
      },
    }

  let client_input =
    test_utils.update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs = [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_commitment: pairs.delete_first(
          input_channel_datum.state.packet_commitment,
          packet.sequence,
        ),
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
  let proof_acked =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"61636b732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
              value: #"8c9178e2ad2afc8d7ccfd8488d1772bf5608cd6b9be915ff2be4e7464260e188",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"000226",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02042620",
                  suffix: #"204d198d6f3ec3241b254b936a97b1169840a51927a724e86bc74768d61c54dae1",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04062620",
                  suffix: #"20072452876773f4e9b67456f4fd55fe48c9492aa788251556eab0975eb57ac2ca",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060a2620",
                  suffix: #"20878870a2a00fe59306a9305b0024c2ea2f8aefec42e0e08fc70793c5a0eda3fc",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08102620",
                  suffix: #"2081c1bbc422016996a2b745a9ac317313d4910afc70c38b08b381326770ba4634",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a262620",
                  suffix: #"207917684c7c65d6789004e264adf6733c969d918b5410bfb7d2ac9b64ea65fe5a",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c502620",
                  suffix: #"20485d70d4a8f04c6b269b5f53257a9f7593c6ce2f3bb45e668538472aecc50685",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"951d596e30a9ff634520dcd1f02fafb1eb97ee4379aa1ea054aa6890de30014e",
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
                  prefix: #"018231ef82a7d9af2deff46bf6b14229163c2bcb013bc12f4188243420db5af65e",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"9ea341b458ca3d49dbaffd8459b0da393b46fd3261b9aea6f165b31811df10b7",
                },
              ],
            },
          },
        },
      ],
    }

  let acknowledgement =
    #"7b22726573756c74223a226257396a6179426859327475623364735a57526e5a57316c626e513d227d"

  let spend_channel_redeemer: Redeemer =
    AcknowledgePacket { packet, proof_acked, proof_height, acknowledgement }

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id,
        data: OtherModuleData,
        acknowledgement: acknowledgement_mod.new_result_acknowledgement("AQ=="),
      },
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
          packet_keys.packet_acknowledgement_path(
            packet.destination_port,
            packet.destination_channel,
            packet.sequence,
          ),
        ],
      ),
    )

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let commit_ack = acknowledgement_mod.commit_acknowledgement(acknowledgement)

  let verify_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_acked,
      path: merkle_path,
      value: commit_ack,
    }

  let acknowledge_packet_redeemer: Redeemer = mock_data.channel_token

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(
        Mint(mock_data.acknowledge_packet_policy_id),
        acknowledge_packet_redeemer,
      ),
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

  acknowledge_packet.acknowledge_packet.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.channel_token,
    #"",
    transaction,
  )
}
