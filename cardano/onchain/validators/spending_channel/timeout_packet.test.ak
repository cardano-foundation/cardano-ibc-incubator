use aiken/collection/pairs
use aiken/primitive/bytearray.{from_int_big_endian}
use cardano/assets.{from_asset}
use cardano/transaction.{
  Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, BatchVerifyMembershipAndNonMembership, VerifyMembership,
  VerifyMembershipParams, VerifyNonMembership, VerifyNonMembershipParams,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{TimeoutOnClose, TimeoutPacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnTimeoutPacket, OtherModuleData,
}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, InnerOp, LeafOp, NonExistenceProof,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/spending_channel_fixture.{MockData, setup}
use spending_channel/timeout_packet

fn check_timeout_unordered_packet(
  use_escrow_shard: Bool,
  include_callback: Bool,
  callback_packet_matches: Bool,
  use_timeout_on_close: Bool,
) {
  let mock_data = setup()

  let pack_timeout_height =
    Height {
      revision_number: 1,
      revision_height: if use_timeout_on_close {
        1000
      } else {
        18
      },
    }

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: pack_timeout_height,
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
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
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

  let module_shard_input =
    Input {
      output_reference: OutputReference {
        ..mock_data.module_input.output_reference,
        output_index: 9,
      },
      output: Output {
        ..mock_data.module_input.output,
        value: from_asset("mock escrow shard policy", "mock shard", 1),
      },
    }
  let callback_input =
    if use_escrow_shard {
      module_shard_input
    } else {
      mock_data.module_input
    }
  let inputs = [mock_data.host_state_input, callback_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 19 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"020402703976bb4e91f05e69c25627e1b813bfeca54f4825afee49efe8acdbd7",
      root: MerkleRoot {
        hash: #"2a2a5880ec8d4d978eaace39e4d256a7d1dbd024f3c471aa8fa14a955d3eb102",
      },
    }

  let client_input =
    test_utils.update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    if use_escrow_shard {
      [mock_data.module_input, mock_data.connection_input, client_input]
    } else {
      [mock_data.connection_input, client_input]
    }

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

  let outputs = [callback_input.output, channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
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

  let proof_close = MerkleProof { proofs: [] }
  let spend_channel_redeemer: Redeemer =
    if use_timeout_on_close {
      TimeoutOnClose {
        packet,
        proof_unreceived,
        proof_close,
        proof_height,
        next_sequence_recv: 0,
      }
    } else {
      TimeoutPacket {
        packet,
        proof_unreceived,
        proof_height,
        next_sequence_recv: 0,
      }
    }

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id,
        packet_data: if callback_packet_matches {
          packet.data
        } else {
          "mismatched packet data"
        },
        data: OtherModuleData,
      },
    )

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)

  let merkle_path =
    merkle.apply_prefix(
      connection_datum.state.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_receipt_path(
            packet.destination_port,
            packet.destination_channel,
            packet.sequence,
          ),
        ],
      ),
    )

  let receipt_non_membership =
    VerifyNonMembershipParams {
      cs: client_datum.state.client_state,
      cons_state,
      height: proof_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: proof_unreceived,
      path: merkle_path,
    }
  let verify_proof_redeemer: Redeemer =
    if use_timeout_on_close {
      let expected_remote_channel =
        Channel {
          state: chan_state_mod.Closed,
          ordering: chan_order_mod.Unordered,
          counterparty: ChannelCounterparty {
            port_id: input_channel_datum.port_id,
            channel_id,
          },
          connection_hops: [connection_datum.state.counterparty.connection_id],
          version: input_channel_datum.state.channel.version,
        }
      let close_membership =
        VerifyMembershipParams {
          cs: client_datum.state.client_state,
          cons_state,
          height: proof_height,
          processed_time: 0,
          processed_height: 0,
          delay_time_period: 0,
          delay_block_period: 0,
          proof: proof_close,
          path: merkle.apply_prefix(
            connection_datum.state.counterparty.prefix,
            merkle.new_merkle_path(
              [
                channel_keys.channel_path(
                  packet.destination_port,
                  packet.destination_channel,
                ),
              ],
            ),
          ),
          value: channel_pb.marshal_for_channel(
            channel.convert_to_channel_proto(expected_remote_channel),
          ).2nd,
        }
      BatchVerifyMembershipAndNonMembership {
        memberships: [close_membership],
        non_memberships: [receipt_non_membership],
      }
    } else {
      VerifyNonMembership {
        cs: receipt_non_membership.cs,
        cons_state: receipt_non_membership.cons_state,
        height: receipt_non_membership.height,
        processed_time: receipt_non_membership.processed_time,
        processed_height: receipt_non_membership.processed_height,
        delay_time_period: receipt_non_membership.delay_time_period,
        delay_block_period: receipt_non_membership.delay_block_period,
        proof: receipt_non_membership.proof,
        path: receipt_non_membership.path,
      }
    }

  let timeout_packet_redeemer: Redeemer = mock_data.channel_token

  let required_redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Mint(mock_data.timeout_packet_policy_id), timeout_packet_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
    ]
  let redeemers =
    if include_callback {
      [
        Pair(Spend(callback_input.output_reference), module_redeemer),
        ..required_redeemers
      ]
    } else {
      required_redeemers
    }

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      reference_inputs,
      outputs,
      redeemers,
      validity_range,
      mint: from_asset(mock_data.timeout_packet_policy_id, "", 1),
    }

  timeout_packet.timeout_packet.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.host_state_nft_policy_id,
    mock_data.channel_token,
    mock_data.timeout_packet_policy_id,
    transaction,
  )
}

test succeed_timeout_unordered_packet() {
  check_timeout_unordered_packet(False, True, True, False)
}

test succeed_timeout_on_close_unordered_future_packet() {
  check_timeout_unordered_packet(False, True, True, True)
}

test timeout_packet_accepts_registered_escrow_shard_callback() {
  check_timeout_unordered_packet(True, True, True, False)
}

test timeout_packet_rejects_missing_voucher_refund_callback() fail {
  check_timeout_unordered_packet(False, False, True, False)
}

test timeout_packet_rejects_mismatched_voucher_refund_packet() fail {
  check_timeout_unordered_packet(False, True, False, False)
}

test timeout_packet_rejects_missing_native_refund_callback() fail {
  check_timeout_unordered_packet(True, False, True, False)
}

test timeout_packet_rejects_mismatched_native_refund_packet() fail {
  check_timeout_unordered_packet(True, True, False, False)
}

test succeed_timeout_ordered_packet() {
  let mock_data = setup()

  let next_sequence_recv = 1

  let pack_timeout_height = Height { revision_number: 1, revision_height: 18 }

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: pack_timeout_height,
      timeout_timestamp: 0,
    }

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: chan_state_mod.Open,
      ordering: chan_order_mod.Ordered,
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
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
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

  let inputs =
    [mock_data.host_state_input, mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height =
    Height {
      ..pack_timeout_height,
      revision_height: pack_timeout_height.revision_height + 1,
    }

  let cons_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"020402703976bb4e91f05e69c25627e1b813bfeca54f4825afee49efe8acdbd7",
      root: MerkleRoot {
        hash: #"2a2a5880ec8d4d978eaace39e4d256a7d1dbd024f3c471aa8fa14a955d3eb102",
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
        channel: Channel {
          ..input_channel_datum.state.channel,
          state: chan_state_mod.Closed,
        },
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

  let outputs = [mock_data.module_input.output, channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_unreceived = MerkleProof { proofs: [] }

  let spend_channel_redeemer: Redeemer =
    TimeoutPacket { packet, proof_unreceived, proof_height, next_sequence_recv }

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id,
        packet_data: packet.data,
        data: OtherModuleData,
      },
    )

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)

  let merkle_path =
    merkle.apply_prefix(
      connection_datum.state.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.next_sequence_recv_path(
            packet.destination_port,
            packet.destination_channel,
          ),
        ],
      ),
    )

  let verify_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: client_datum.state.client_state,
      cons_state,
      height: proof_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: proof_unreceived,
      path: merkle_path,
      value: from_int_big_endian(next_sequence_recv, 8),
    }

  let timeout_packet_redeemer: Redeemer = mock_data.channel_token

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Mint(mock_data.timeout_packet_policy_id), timeout_packet_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
    ]
  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      reference_inputs,
      outputs,
      redeemers,
      validity_range,
      mint: from_asset(mock_data.timeout_packet_policy_id, "", 1),
    }

  timeout_packet.timeout_packet.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.host_state_nft_policy_id,
    mock_data.channel_token,
    mock_data.timeout_packet_policy_id,
    transaction,
  )
}

test timeout_on_close_recovers_second_future_packet_from_closed_ordered_channel() {
  let mock_data = setup()
  let first_packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "first packet",
      timeout_height: Height { revision_number: 1, revision_height: 18 },
      timeout_timestamp: 0,
    }
  let second_packet =
    Packet {
      ..first_packet,
      sequence: 2,
      data: "second packet",
      timeout_height: Height { revision_number: 1, revision_height: 1000 },
    }

  let open_channel =
    Channel {
      state: chan_state_mod.Open,
      ordering: chan_order_mod.Ordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }
  let empty_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
        channel: open_channel,
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
  let two_packet_datum =
    test_utils.send_packet(
      second_packet,
      test_utils.send_packet(first_packet, empty_channel_datum),
    )
  let input_channel_datum =
    ChannelDatum {
      ..two_packet_datum,
      state: ChannelDatumState {
        ..two_packet_datum.state,
        channel: Channel {
          ..two_packet_datum.state.channel,
          state: chan_state_mod.Closed,
        },
        packet_commitment: pairs.delete_first(
          two_packet_datum.state.packet_commitment,
          first_packet.sequence,
        ),
      },
    }
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_commitment: pairs.delete_first(
          input_channel_datum.state.packet_commitment,
          second_packet.sequence,
        ),
      },
    }
  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)
  let channel_output =
    test_utils.build_channel_output(
      output_channel_datum,
      mock_data.channel_token,
    )

  let proof_height = Height { revision_number: 1, revision_height: 19 }
  let consensus_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"020402703976bb4e91f05e69c25627e1b813bfeca54f4825afee49efe8acdbd7",
      root: MerkleRoot {
        hash: #"2a2a5880ec8d4d978eaace39e4d256a7d1dbd024f3c471aa8fa14a955d3eb102",
      },
    }
  let client_input =
    test_utils.update_client(
      proof_height,
      consensus_state,
      mock_data.client_input,
    )
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)

  let proof_unreceived = MerkleProof { proofs: [] }
  let proof_close = MerkleProof { proofs: [] }
  let next_sequence_recv = 2
  let spend_channel_redeemer: Redeemer =
    TimeoutOnClose {
      packet: second_packet,
      proof_unreceived,
      proof_close,
      proof_height,
      next_sequence_recv,
    }

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id,
        packet_data: second_packet.data,
        data: OtherModuleData,
      },
    )

  let common_membership =
    VerifyMembershipParams {
      cs: client_datum.state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: proof_unreceived,
      path: merkle.apply_prefix(
        connection_datum.state.counterparty.prefix,
        merkle.new_merkle_path(
          [
            packet_keys.next_sequence_recv_path(
              second_packet.destination_port,
              second_packet.destination_channel,
            ),
          ],
        ),
      ),
      value: from_int_big_endian(next_sequence_recv, 8),
    }
  let expected_remote_channel =
    Channel {
      state: chan_state_mod.Closed,
      ordering: chan_order_mod.Ordered,
      counterparty: ChannelCounterparty {
        port_id: input_channel_datum.port_id,
        channel_id,
      },
      connection_hops: [connection_datum.state.counterparty.connection_id],
      version: input_channel_datum.state.channel.version,
    }
  let close_membership =
    VerifyMembershipParams {
      ..common_membership,
      proof: proof_close,
      path: merkle.apply_prefix(
        connection_datum.state.counterparty.prefix,
        merkle.new_merkle_path(
          [
            channel_keys.channel_path(
              second_packet.destination_port,
              second_packet.destination_channel,
            ),
          ],
        ),
      ),
      value: channel_pb.marshal_for_channel(
        channel.convert_to_channel_proto(expected_remote_channel),
      ).2nd,
    }
  let verify_proof_redeemer: Redeemer =
    BatchVerifyMembership([common_membership, close_membership])
  let timeout_packet_redeemer: Redeemer = mock_data.channel_token
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Mint(mock_data.timeout_packet_policy_id), timeout_packet_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [
        mock_data.host_state_input,
        mock_data.module_input,
        channel_input,
      ],
      reference_inputs: [mock_data.connection_input, client_input],
      outputs: [mock_data.module_input.output, channel_output],
      redeemers,
      validity_range: mock_data.validity_range,
      mint: from_asset(mock_data.timeout_packet_policy_id, "", 1),
    }

  timeout_packet.timeout_packet.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.host_state_nft_policy_id,
    mock_data.channel_token,
    mock_data.timeout_packet_policy_id,
    transaction,
  )
}
