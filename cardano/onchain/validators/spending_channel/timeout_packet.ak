use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/interval
use aiken/primitive/bytearray.{from_int_big_endian}
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyNonMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{TimeoutPacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnTimeoutPacket, OtherModuleData,
}
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, InnerOp, InnerSpec, LeafOp, NonExistenceProof, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils

validator timeout_packet(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    channel_token: AuthToken,
    _spent_output: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = transaction

    expect Some((datum, channel_redeemer, spent_output)) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect auth.contain_auth_token(spent_output, datum.token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    expect auth.contain_auth_token(updated_output, datum.token)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect [connection_id] = datum.state.channel.connection_hops

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect TimeoutPacket {
      packet,
      proof_unreceived,
      proof_height,
      next_sequence_recv,
    } = channel_redeemer

    trace @"timeout_packet: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState {
      channel: cur_channel,
      packet_commitment: cur_packet_commitment,
      ..
    } = cur_channel_state

    expect cur_channel.state == chan_state_mod.Open
    trace @"timeout_packet: channel state is open"

    expect and {
        packet.source_port == port_id,
        packet.source_channel == channel_id,
        packet.destination_port == cur_channel.counterparty.port_id,
        packet.destination_channel == cur_channel.counterparty.channel_id,
      }
    trace @"timeout_packet: packet info matched channel state"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"timeout_packet: reference_inputs contain Connection utxo"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"timeout_packet: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"timeout_packet: client status is active"

    expect Some(proof_timestamp) =
      client_state_mod.get_timestamp_at_height(
        client_datum.state.client_state,
        client_datum.state.consensus_states,
        proof_height,
      )
    expect or {
        !height_mod.is_zero(packet.timeout_height) && !(height_mod.compare(
          proof_height,
          packet.timeout_height,
        ) == Less),
        packet.timeout_timestamp != 0 && proof_timestamp >= packet.timeout_timestamp,
      }
    trace @"timeout_packet: packet is timeout"

    expect Some(commitment) =
      pairs.get_first(cur_packet_commitment, packet.sequence)
    trace @"timeout_packet: packet commitment existed"

    let packet_commitment = packet_mod.commit_packet(packet)
    expect commitment == packet_commitment
    trace @"timeout_packet: timeout packet match commit packet"

    expect
      when cur_channel.ordering is {
        chan_order_mod.Unordered -> {
          trace @"timeout_packet: channel ordering is  Unordered"

          expect
            validate_timeout_unordered_packet_proof(
              connection_datum.state,
              client_datum.state,
              proof_height,
              proof_unreceived,
              packet,
              redeemers,
              verify_proof_policy_id,
            )
          trace @"timeout_packet: packet proof is valid"

          True
        }
        chan_order_mod.Ordered -> {
          trace @"timeout_packet: channel ordering is not Unordered"

          expect next_sequence_recv <= packet.sequence
          trace @"timeout_packet: packet not received yet"

          expect
            validate_timeout_ordered_packet_proof(
              connection_datum.state,
              client_datum.state,
              proof_height,
              proof_unreceived,
              packet,
              next_sequence_recv,
              redeemers,
              verify_proof_policy_id,
            )
          trace @"timeout_packet: packet proof is valid"

          True
        }
        _ -> False
      }

    expect
      channel_datum_mod.validate_timeout_packet(datum, updated_datum, packet)
    trace @"timeout_packet: channel datum is updated valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect OnTimeoutPacket { channel_id: module_chan_id, .. } =
      ibc_module_callback
    expect module_chan_id == channel_id
    trace @"timeout_packet: ibc module callback is valid"

    True
  }

  else(_) {
    fail
  }
}

fn validate_timeout_unordered_packet_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof: MerkleProof,
  packet: Packet,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
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
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  expect
    verify_proof_redeemer == VerifyNonMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof,
      path: merkle_path,
    }

  True
}

fn validate_timeout_ordered_packet_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof: MerkleProof,
  packet: Packet,
  next_sequence_recv: Int,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.next_sequence_recv_path(
            packet.destination_port,
            packet.destination_channel,
          ),
        ],
      ),
    )
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  expect
    verify_proof_redeemer == VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof,
      path: merkle_path,
      value: from_int_big_endian(next_sequence_recv, 8),
    }

  True
}

//==========================================Test================================================

type MockData {
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_minting_policy_id: PolicyId,
  chan_open_ack_policy_id: PolicyId,
  chan_open_confirm_policy_id: PolicyId,
  recv_packet_policy_id: PolicyId,
  send_packet_policy_id: PolicyId,
  timeout_packet_policy_id: PolicyId,
  acknowledge_packet_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  channel_sequence: ByteArray,
  channel_token: AuthToken,
  handler_token: AuthToken,
  connection_id: ByteArray,
  connection_input: Input,
  client_input: Input,
  validity_range: ValidityRange,
  port_id: ByteArray,
  module_input: Input,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  //========================Channel============================
  let channel_sequence = "0"
  let channel_minting_policy_id = "mock channel_minting_policy_id"

  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      chan_keys_mod.channel_prefix,
      channel_sequence,
    )
  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  //========================Connection============================
  let connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
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
      },
      token: AuthToken { name: "", policy_id: "" },
    }

  let connection_id = "connection-134"

  let connection_sequence =
    conn_keys_mod.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name(
      handler_token,
      conn_keys_mod.connection_prefix,
      connection_sequence,
    )

  let connection_minting_policy_id = "mock connection_minting_policy_id"

  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: connection_token_name,
    }

  let connection_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock connection script hash"),
        value: from_asset(connection_token.policy_id, connection_token.name, 1),
        datum: InlineDatum(connection_datum),
        reference_script: None,
      },
    }

  //========================Client============================
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

  let client_sequence =
    client_keys_mod.parse_client_id_sequence(connection_datum.state.client_id)

  let client_token_name =
    auth.generate_token_name(
      handler_token,
      client_keys_mod.client_prefix,
      client_sequence,
    )

  let client_minting_policy_id = "mock client_minting_policy_id"

  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: [Pair(proof_height, cons_state)],
      },
      token: client_token,
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock client script hash"),
        value: from_asset(client_token.policy_id, client_token.name, 1),
        datum: InlineDatum(client_datum),
        reference_script: None,
      },
    }

  //==========================ValidityRange===========================
  let valid_to =
    ( cons_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1
  let validity_range = interval.before(valid_to)

  //==========================Module===========================
  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_id = "port-1"
  let port_number = port_keys_mod.parse_port_id_number(port_id)
  let port_token_name =
    auth.generate_token_name(
      handler_token,
      port_keys_mod.port_prefix,
      port_number,
    )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock module script hash"),
        value: from_asset(port_token.policy_id, port_token.name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  MockData {
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    spend_channel_script_hash: "mock spend_channel_script_hash",
    channel_minting_policy_id,
    chan_open_ack_policy_id: "mock chan_open_ack_policy_id",
    chan_open_confirm_policy_id: "mock chan_open_confirm_policy_id",
    recv_packet_policy_id: "mock recv_packet_policy_id",
    send_packet_policy_id: "mock send_packet_policy_id",
    timeout_packet_policy_id: "mock timeout_packet_policy_id",
    acknowledge_packet_policy_id: "mock acknowledge_packet_policy_id",
    verify_proof_policy_id: "mock verify_proof_policy_id",
    channel_sequence,
    channel_token,
    handler_token,
    connection_id,
    connection_input,
    client_input,
    validity_range,
    port_id,
    module_input,
  }
}

test succeed_timeout_unordered_packet() {
  let mock_data = setup()

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

  let spend_channel_redeemer: Redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived,
      proof_height,
      next_sequence_recv: 0,
    }

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id, data: OtherModuleData })

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

  let verify_proof_redeemer: Redeemer =
    VerifyNonMembership {
      cs: client_datum.state.client_state,
      cons_state,
      height: proof_height,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: proof_unreceived,
      path: merkle_path,
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
      inputs: inputs,
      reference_inputs: reference_inputs,
      outputs: outputs,
      redeemers: redeemers,
      validity_range: validity_range,
    }

  timeout_packet.spend(
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

  let outputs = [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_unreceived = MerkleProof { proofs: [] }

  let spend_channel_redeemer: Redeemer =
    TimeoutPacket { packet, proof_unreceived, proof_height, next_sequence_recv }

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(OnTimeoutPacket { channel_id, data: OtherModuleData })

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
      inputs: inputs,
      reference_inputs: reference_inputs,
      outputs: outputs,
      redeemers: redeemers,
      validity_range: validity_range,
    }

  timeout_packet.spend(
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
