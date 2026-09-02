use aiken/builtin
use aiken/cbor
use aiken/collection/pairs
use aiken/fuzz
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{from_script}
use cardano/assets.{add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use host_state_stt
use ibc/apps/transfer/types/fungible_token_packet_data
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/state.{Open}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
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
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, InnerSpec,
  LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, ModuleRegistration,
  empty_ibc_state_root, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{HandlePacket}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/bits
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/recv_packet
use spending_channel/spending_channel_fixture.{MockData, setup}

fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn full_empty_siblings() -> List<ByteArray> {
  repeat_bytearray(
    ibc_state_commitment.empty_hash,
    ibc_state_commitment.merkle_depth_bits,
  )
}

fn key_bit(key_hash: ByteArray, depth: Int) -> Int {
  let byte_index = 7 - depth / 8
  let bit_in_byte = depth % 8
  bits.shr(builtin.index_bytearray(key_hash, byte_index), bit_in_byte) % 2
}

fn last_different_key_bit(
  first_hash: ByteArray,
  second_hash: ByteArray,
  depth: Int,
  last_difference: Int,
) -> Int {
  if depth == ibc_state_commitment.merkle_depth_bits {
    expect last_difference >= 0
    last_difference
  } else {
    last_different_key_bit(
      first_hash,
      second_hash,
      depth + 1,
      if key_bit(first_hash, depth) != key_bit(second_hash, depth) {
        depth
      } else {
        last_difference
      },
    )
  }
}

fn raise_single_leaf(
  key_hash: ByteArray,
  current: ByteArray,
  depth: Int,
  target_depth: Int,
) -> ByteArray {
  if depth == target_depth {
    current
  } else {
    let next =
      if key_bit(key_hash, depth) == 0 {
        ibc_state_commitment.inner_hash(
          current,
          ibc_state_commitment.empty_hash,
        )
      } else {
        ibc_state_commitment.inner_hash(
          ibc_state_commitment.empty_hash,
          current,
        )
      }
    raise_single_leaf(key_hash, next, depth + 1, target_depth)
  }
}

fn single_sibling_list(
  depth: Int,
  sibling_depth: Int,
  sibling: ByteArray,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    [
      if depth == sibling_depth {
        sibling
      } else {
        ibc_state_commitment.empty_hash
      },
      ..single_sibling_list(depth + 1, sibling_depth, sibling)
    ]
  }
}

fn siblings_after_single_insert(
  existing_key: ByteArray,
  existing_value: ByteArray,
  target_key: ByteArray,
) -> List<ByteArray> {
  let existing_key_hash = builtin.sha2_256(existing_key)
  let target_key_hash = builtin.sha2_256(target_key)
  let divergence =
    last_different_key_bit(existing_key_hash, target_key_hash, 0, -1)
  let existing_leaf =
    ibc_state_commitment.leaf_hash(
      existing_key_hash,
      ibc_state_commitment.value_hash(existing_value),
    )
  let sibling =
    raise_single_leaf(existing_key_hash, existing_leaf, 0, divergence)
  single_sibling_list(0, divergence, sibling)
}

fn check_recv_packet_with_timeout(
  include_module_callback: Bool,
  mutate_successor: Bool,
  match_callback_packet: Bool,
  match_callback_acknowledgement: Bool,
  preserve_module_binding: Bool,
  compose_host_state: Bool,
  packet_data: ByteArray,
  timeout_height: Height,
  timeout_timestamp: Int,
) -> Bool {
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

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)

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
      data: packet_data,
      timeout_height,
      timeout_timestamp,
    }

  let valid_output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        maximum_receive_proof_height: proof_height,
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
  let output_channel_datum =
    if mutate_successor {
      ChannelDatum { ..valid_output_channel_datum, port_id: "port-999" }
    } else {
      valid_output_channel_datum
    }

  let channel_output =
    test_utils.build_channel_output(
      output_channel_datum,
      mock_data.channel_token,
    )

  // Compose the receive marker with the HostState transition over the same
  // transaction. The old tree is empty; receipt insertion is followed by the
  // acknowledgement insertion using the resulting sparse-tree witness.
  let packet_receipt_siblings = full_empty_siblings()
  let receipt_key =
    packet_keys.packet_receipt_path(
      input_channel_datum.port_id,
      channel_id,
      packet.sequence,
    )
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path(
      input_channel_datum.port_id,
      channel_id,
      packet.sequence,
    )
  let receipt_value = cbor.serialise("")
  let root_after_receipt =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      receipt_key,
      "",
      receipt_value,
      packet_receipt_siblings,
    )
  let packet_acknowledgement_siblings =
    siblings_after_single_insert(
      receipt_key,
      receipt_value,
      acknowledgement_key,
    )
  let updated_root =
    ibc_state_commitment.apply_update(
      root_after_receipt,
      acknowledgement_key,
      "",
      cbor.serialise(commit_ack),
      packet_acknowledgement_siblings,
    )
  let host_nft_policy = mock_data.host_state_nft_policy_id
  expect registered_host_datum: HostStateDatum =
    validator_utils.get_inline_datum(mock_data.host_state_input.output)
  let deployer = registered_host_datum.deployer
  let old_host_state =
    HostState {
      ..registered_host_datum.state,
      version: 0,
      ibc_state_root: empty_ibc_state_root,
    }
  let new_host_state =
    HostState { ..old_host_state, version: 1, ibc_state_root: updated_root }
  let host_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock host state script hash"),
        value: from_asset(host_nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          HostStateDatum {
            state: old_host_state,
            nft_policy: host_nft_policy,
            deployer,
            control: registered_host_datum.control,
          },
        ),
        reference_script: None,
      },
    }
  let host_output =
    Output {
      ..host_input.output,
      datum: InlineDatum(
        HostStateDatum {
          state: new_host_state,
          nft_policy: host_nft_policy,
          deployer,
          control: registered_host_datum.control,
        },
      ),
    }

  let inputs =
    if include_module_callback {
      if compose_host_state {
        [mock_data.module_input, channel_input, host_input]
      } else {
        [mock_data.module_input, channel_input, mock_data.host_state_input]
      }
    } else if compose_host_state {
      [channel_input, host_input]
    } else {
      [channel_input, mock_data.host_state_input]
    }

  let outputs =
    if include_module_callback {
      let module_output =
        Output {
          ..mock_data.module_input.output,
          address: if preserve_module_binding {
            mock_data.module_input.output.address
          } else {
            from_script("wrong-module-script")
          },
        }
      if compose_host_state {
        [channel_output, module_output, host_output]
      } else {
        [channel_output, module_output]
      }
    } else if compose_host_state {
      [channel_output, host_output]
    } else {
      [channel_output]
    }

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
      OnRecvPacket {
        channel_id,
        packet_data: if match_callback_packet {
          packet.data
        } else {
          "wrong"
        },
        acknowledgement: if match_callback_acknowledgement {
          ack
        } else {
          acknowledgement_mod.new_error_acknowledgement("wrong")
        },
        data: OtherModuleData,
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
      processed_time: 0,
      processed_height: 0,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_commitment,
      path: merkle_path,
      value: commitment,
    }

  let recv_packet_redeemer: Redeemer = mock_data.channel_token
  let host_state_redeemer =
    HandlePacket {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings,
      packet_acknowledgement_siblings,
    }
  let host_state_redeemer_data: Redeemer = host_state_redeemer
  let host_state_redeemers =
    if compose_host_state {
      [Pair(Spend(host_input.output_reference), host_state_redeemer_data)]
    } else {
      []
    }

  let required_redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Mint(mock_data.recv_packet_policy_id), recv_packet_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
      ..host_state_redeemers
    ]
  let redeemers =
    if include_module_callback {
      [
        Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
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
      mint: from_asset(mock_data.recv_packet_policy_id, "", 1),
    }

  let recv_packet_valid =
    recv_packet.recv_packet.mint(
      mock_data.client_minting_policy_id,
      mock_data.connection_minting_policy_id,
      mock_data.port_minting_policy_id,
      mock_data.verify_proof_policy_id,
      mock_data.host_state_nft_policy_id,
      mock_data.channel_token,
      mock_data.recv_packet_policy_id,
      transaction,
    )
  if compose_host_state {
    and {
      recv_packet_valid?,
      host_state_stt.host_state_stt.spend(
        host_nft_policy,
        "unused client script hash",
        "unused connection script hash",
        "mock spend channel script hash",
        None,
        host_state_redeemer,
        host_input.output_reference,
        transaction,
      )?,
    }
  } else {
    recv_packet_valid
  }
}

fn check_recv_packet(
  include_module_callback: Bool,
  mutate_successor: Bool,
  match_callback_packet: Bool,
  match_callback_acknowledgement: Bool,
  preserve_module_binding: Bool,
  compose_host_state: Bool,
) -> Bool {
  check_recv_packet_with_timeout(
    include_module_callback,
    mutate_successor,
    match_callback_packet,
    match_callback_acknowledgement,
    preserve_module_binding,
    compose_host_state,
    "mock packet data",
    Height { revision_number: 0, revision_height: 0 },
    1735689600000000000,
  )
}

fn check_recv_packet_timeout(
  timeout_height: Height,
  timeout_timestamp: Int,
) -> Bool {
  check_recv_packet_with_timeout(
    True,
    False,
    True,
    True,
    True,
    False,
    "mock packet data",
    timeout_height,
    timeout_timestamp,
  )
}

test succeed_recv_packet() {
  check_recv_packet(True, False, True, True, True, False)
}

test succeed_recv_packet_maximum_ics20_packet() {
  let packet_data =
    #"7b2264656e6f6d223a226962632f75736474222c22616d6f756e74223a22313030222c2273656e646572223a22636f736d6f732073656e6465722061646472657373222c227265636569766572223a223532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232222c226d656d6f223a225c753030306261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161227d"
  expect
    bytearray.length(packet_data) == fungible_token_packet_data.max_packet_bytes

  check_recv_packet_with_timeout(
    True,
    False,
    True,
    True,
    True,
    False,
    packet_data,
    Height { revision_number: 0, revision_height: 0 },
    1735689600000000000,
  )
}

test prop_tx_recv_packet_accepts_atomic_successor_and_callback(
  _seed via fuzz.int(),
) {
  fuzz.label(@"regression.tx.packet.recv.valid_atomic_successor_callback")
  check_recv_packet(True, False, True, True, True, True)
}

test prop_tx_recv_packet_rejects_missing_application_callback(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.packet.recv.invalid_missing_application_callback")
  check_recv_packet(False, False, True, True, True, True)
}

test prop_tx_recv_packet_rejects_moved_port_binding(_seed via fuzz.int()) fail {
  fuzz.label(@"regression.tx.packet.recv.invalid_moved_port_binding")
  check_recv_packet(True, False, True, True, False, True)
}

test prop_tx_recv_packet_rejects_unrelated_successor_mutation(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.packet.recv.invalid_unrelated_successor_mutation")
  check_recv_packet(True, True, True, True, True, True)
}

test prop_tx_recv_packet_rejects_callback_packet_data_mismatch(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.packet.recv.invalid_callback_packet_data")
  check_recv_packet(True, False, False, True, True, True)
}

test prop_tx_recv_packet_rejects_callback_acknowledgement_mismatch(
  _seed via fuzz.int(),
) fail {
  fuzz.label(@"regression.tx.packet.recv.invalid_callback_acknowledgement")
  check_recv_packet(True, False, True, False, True, True)
}

test recv_packet_rejects_height_only_timeout() fail {
  check_recv_packet_timeout(
    Height { revision_number: 0, revision_height: 100 },
    0,
  )
}

test recv_packet_rejects_mixed_height_and_timestamp_timeout() fail {
  check_recv_packet_timeout(
    Height { revision_number: 0, revision_height: 100 },
    1735689600000000000,
  )
}

test recv_packet_fails_when_channel_is_closed() fail {
  let mock_data = setup()

  let channel_id =
    chan_keys_mod.format_channel_identifier(mock_data.channel_sequence)

  let input_channel =
    Channel {
      state: chan_state_mod.Closed,
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

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)

  let channel_output =
    test_utils.build_channel_output(
      input_channel_datum,
      mock_data.channel_token,
    )

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

  let spend_channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: MerkleProof { proofs: [] },
      proof_height: Height { revision_number: 1, revision_height: 19 },
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [Pair(Spend(channel_input.output_reference), spend_channel_redeemer)]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [channel_input],
      outputs: [channel_output],
      redeemers,
      validity_range: mock_data.validity_range,
      mint: from_asset(mock_data.recv_packet_policy_id, "", 1),
    }

  recv_packet.recv_packet.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.host_state_nft_policy_id,
    mock_data.channel_token,
    mock_data.recv_packet_policy_id,
    transaction,
  )
}

test recv_packet_non_mock_data_rejects_mixed_timeout() fail {
  let client_minting_policy_id =
    #"dcecce6c178dae972476121042b79ac470bd9c2797bedea2c1906e8a"
  let connection_minting_policy_id =
    #"e4d9c21512117b37daf57e852c5629dc8f5f9e4b1a8dde3312e597df"
  let port_minting_policy_id =
    #"b28620755b65066a860e6ff8e1772bb65e73b60dd21d099b2457052b"
  let verify_proof_policy_id =
    #"f94ca68702f061f67713298edda2dd59eaab7b9de711e4728bfe6e03"
  let host_state_nft_policy_id =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let recv_packet_policy_id =
    #"fb62d2738f5a9fdf049ef19229f82b4b427ed0aceab4282ba9a56039"

  let validity_range = interval.before(1741267622930)

  let channel_token =
    AuthToken {
      name: #"c9fcf5b1fea9b80fe522703584970ab449b0e30b239b722030",
      policy_id: port_minting_policy_id,
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
        channel: Channel {
          state: chan_state_mod.Open,
          ordering: chan_order_mod.Unordered,
          counterparty: ChannelCounterparty {
            port_id: "vesseloracle",
            channel_id: "channel-1",
          },
          connection_hops: ["connection-0"],
          version: "ics20-1",
        },
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-100",
      token: channel_token,
    }

  let updated_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: [
          Pair(1, ""),
          ..input_channel_datum.state.packet_receipt
        ],
        packet_acknowledgement: [
          Pair(
            1,
            #"08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c",
          ),
          ..input_channel_datum.state.packet_acknowledgement
        ],
      },
    }

  let spend_channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"713a117bf0b6f537ef10dbe48d6ce55cfe9f419553c6ff9d0ed3d7d6e72407ec",
        output_index: 0,
      },
      output: Output {
        address: from_script(channel_token.policy_id),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(input_channel_datum),
        reference_script: None,
      },
    }

  let port_token_name = port_keys.port_token_name(input_channel_datum.port_id)
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }
  let module_token =
    AuthToken { policy_id: "module-token-policy", name: "module-token-name" }
  let module_registration =
    ModuleRegistration {
      module_script_hash: "module-script",
      port_token,
      module_token,
    }
  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        output_index: 0,
      },
      output: Output {
        address: from_script("module-script"),
        value: from_asset(port_token.policy_id, port_token.name, 1)
          |> add(module_token.policy_id, module_token.name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }

  let host_state_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        output_index: 0,
      },
      output: Output {
        address: from_script("host-state-script"),
        value: from_asset(host_state_nft_policy_id, host_state_token_name, 1),
        datum: InlineDatum(
          HostStateDatum {
            state: HostState {
              version: 0,
              ibc_state_root: empty_ibc_state_root,
              next_client_sequence: 0,
              next_connection_sequence: 0,
              next_channel_sequence: 0,
              bound_port: [],
              last_update_time: 0,
            },
            nft_policy: host_state_nft_policy_id,
            deployer: #"00000000000000000000000000000000000000000000000000000000",
            control: HostStateControl {
              port_registry: [
                Pair(input_channel_datum.port_id, module_registration),
              ],
              shutdown: Active,
            },
          },
        ),
        reference_script: None,
      },
    }

  let inputs = [module_input, spend_channel_input, host_state_input]

  let outputs =
    [
      Output {
        address: from_script(channel_token.policy_id),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(updated_channel_datum),
        reference_script: None,
      },
      module_input.output,
    ]

  let merkle_proof =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"636f6d6d69746d656e74732f706f7274732f76657373656c6f7261636c652f6368616e6e656c732f6368616e6e656c2d312f73657175656e6365732f31",
              value: #"d6c57fcf5d631c919dc03313939bb2837eb58d2429ccdc0e58da8892682ad808",
              leaf: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"0002fc15",
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0204ec2120",
                  suffix: #"2098d56cfbf609dcb504c0e2e783e749308e5f906b700d862ba11783cfbc740eef",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0408ec2120",
                  suffix: #"204567bfa5733c1c6df4e45c62d3b76d92dfaab4507bae2031a9f616d03ab90fc6",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0812962820b55104911444196c40bb644c895b81b4af8e7fd426190108ccbfe8244d74766120",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a2a962820",
                  suffix: #"2051b989ccba53bef32ebd77b31327f8a8d639036cd0233225902f129a5e63f053",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c4e962820529acae54cab0c6a7935224978d33574ca6d5fe9c00c0ff357595b3c43b26c9d20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"10c2019628208876c99e1efbead55b0569096fa38174906988292eae9de52144bb0e7a36da5820",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"12b4029628202ec19c15dc5338f58df8b4d5793f276ac8cb24fa3ebe45294fc393feacd54f7220",
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
              value: #"4efda2f59ef35f61cb713e7c4f15726c5a6b10d16ad395699e67964096e552e9",
              leaf: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
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
                  prefix: #"0124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01d9da9cc6cd7d15bfc13c7acb16306edaed0295c6934e33675a3101dd4f0333ad",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"bdad1f5b93fa637bc5444eb8825b9dd49d7730109813ae4db53a815ceb74b4b5",
                },
              ],
            },
          },
        },
      ],
    }

  let mint_verifying_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: ClientState {
        chain_id: #"76657373656c6f7261636c65",
        trust_level: UncheckedRational { numerator: 1, denominator: 3 },
        trusting_period: 129600000000000,
        unbonding_period: 1814400000000000,
        max_clock_drift: 600000000000,
        frozen_height: Height { revision_number: 0, revision_height: 0 },
        latest_height: Height { revision_number: 0, revision_height: 2709 },
        proof_specs: [
          ProofSpec {
            leaf_spec: LeafOp {
              hash: 1,
              prehash_key: 0,
              prehash_value: 1,
              length: 1,
              prefix: #"00",
            },
            inner_spec: InnerSpec {
              child_order: [0, 1],
              child_size: 33,
              min_prefix_length: 4,
              max_prefix_length: 12,
              empty_child: #"",
              hash: 1,
            },
            max_depth: 0,
            min_depth: 0,
            prehash_key_before_comparison: False,
          },
          ProofSpec {
            leaf_spec: LeafOp {
              hash: 1,
              prehash_key: 0,
              prehash_value: 1,
              length: 1,
              prefix: #"00",
            },
            inner_spec: InnerSpec {
              child_order: [0, 1],
              child_size: 32,
              min_prefix_length: 1,
              max_prefix_length: 1,
              empty_child: #"",
              hash: 1,
            },
            max_depth: 0,
            min_depth: 0,
            prehash_key_before_comparison: False,
          },
        ],
      },
      cons_state: ConsensusState {
        timestamp: 1741257055001676886,
        next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
        root: MerkleRoot {
          hash: #"3adc293f2faa9b848c7369430a8ef73377e30ffee1d686cda373c630cda43039",
        },
      },
      height: Height { revision_height: 2709, revision_number: 0 },
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: merkle_proof,
      path: MerklePath {
        key_path: [
          #"696263",
          #"636f6d6d69746d656e74732f706f7274732f76657373656c6f7261636c652f6368616e6e656c732f6368616e6e656c2d312f73657175656e6365732f31",
        ],
      },
      value: #"aeb779503b62b553008521eee75d2082e1bf687fcc9406479a8246a8680d3be5",
    }

  let client_token =
    AuthToken {
      policy_id: client_minting_policy_id,
      name: #"c9fcf5b1fea9b80fe522703584970ab449b0e30bf2c9db6430",
    }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: ClientState {
          chain_id: "vesseloracle",
          trust_level: UncheckedRational { numerator: 1, denominator: 3 },
          trusting_period: 129600000000000,
          unbonding_period: 1814400000000000,
          max_clock_drift: 600000000000,
          frozen_height: Height { revision_number: 0, revision_height: 0 },
          latest_height: Height { revision_number: 0, revision_height: 2709 },
          proof_specs: [
            ProofSpec {
              leaf_spec: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
              },
              inner_spec: InnerSpec {
                child_order: [0, 1],
                child_size: 33,
                min_prefix_length: 4,
                max_prefix_length: 12,
                empty_child: #"",
                hash: 1,
              },
              max_depth: 0,
              min_depth: 0,
              prehash_key_before_comparison: False,
            },
            ProofSpec {
              leaf_spec: LeafOp {
                hash: 1,
                prehash_key: 0,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
              },
              inner_spec: InnerSpec {
                child_order: [0, 1],
                child_size: 32,
                min_prefix_length: 1,
                max_prefix_length: 1,
                empty_child: #"",
                hash: 1,
              },
              max_depth: 0,
              min_depth: 0,
              prehash_key_before_comparison: False,
            },
          ],
        },
        consensus_states: [
          Pair(
            Height { revision_number: 0, revision_height: 98 },
            ConsensusState {
              timestamp: 1741254316161000000,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"db7b734824f145a1ada25a5605443a236caa4cd2b8664c9cd64066440232632a",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 386 },
            ConsensusState {
              timestamp: 1741254608959915587,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"d103d32226a3c0eae5b1590c556277ece79b93d95fecca2a2f7baea1dddeaa52",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 595 },
            ConsensusState {
              timestamp: 1741254823578866673,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"7637379e23567b1157e22786b847f2148c31d504e9934d34c6fac54ad8605f63",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 827 },
            ConsensusState {
              timestamp: 1741255060481338254,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"4a421aac294eafa063b32141fea479907463f81d00b0b164cafb76fe63437a99",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1012 },
            ConsensusState {
              timestamp: 1741255249952287676,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"783c76b484dfec3929cdb3cb356f31cef1c7f08062c95735488ead7231a41e7f",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1407 },
            ConsensusState {
              timestamp: 1741255663757617589,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"19ddee6c7a15832acb5f91ebd1dc1146eed655e9a7a1c981217e839d9f1292bd",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1513 },
            ConsensusState {
              timestamp: 1741255773199000209,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"53cec73099c727dfe0962baa54025dfd4fd405895585df636f81369f38fff200",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1720 },
            ConsensusState {
              timestamp: 1741256002709180093,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"f5f375c70dcf6d85ac74fcc179fd907de761139d0c0e002bd2f55a3e0ea29ff8",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1867 },
            ConsensusState {
              timestamp: 1741256153238979844,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"55c247e34affcd914cd5b0bd7d13eab3b6439393f337e72659a2532b5ddab6c0",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 1976 },
            ConsensusState {
              timestamp: 1741256283594037584,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"35e5d4b87f662ef58276a2cded0997b55613496d79724f8d22f5ef84b79c1669",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2077 },
            ConsensusState {
              timestamp: 1741256386803412632,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"8310bbdcb3bfa53eed4328d78fa90d0af6a2b9fd53fc158ffa582dbb3a30454a",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2295 },
            ConsensusState {
              timestamp: 1741256616569878877,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"fcdf83d49544f7308dd6f59776d54ae791b0d999ed67851b04bb3be8ca80b436",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2491 },
            ConsensusState {
              timestamp: 1741256832126959713,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"eb43bb4b440a75cbafb37506c85461862b050c8d4d5e6d27a65a77cb30216a0f",
              },
            },
          ),
          Pair(
            Height { revision_number: 0, revision_height: 2709 },
            ConsensusState {
              timestamp: 1741257055001676886,
              next_validators_hash: #"a44f883b245331d58ec1b6a45fa6bdc63ee5648716989496a3fe7dfcb4cc7e87",
              root: MerkleRoot {
                hash: #"3adc293f2faa9b848c7369430a8ef73377e30ffee1d686cda373c630cda43039",
              },
            },
          ),
        ],
        processed_times: [
          Pair(Height { revision_number: 0, revision_height: 2709 }, 0),
        ],
        processed_heights: [
          Pair(Height { revision_number: 0, revision_height: 2709 }, 0),
        ],
      },
      token: client_token,
    }

  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: #"c9fcf5b1fea9b80fe522703584970ab449b0e30b19dd9b3030",
    }

  let connection_end =
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
        client_id: "08-cardano-probabilistic-0",
        connection_id: "connection-0",
        prefix: MerklePrefix { key_prefix: "ibc" },
      },
      delay_period: 0,
    }

  let connection_datum =
    ConnectionDatum { state: connection_end, token: connection_token }

  let reference_inputs =
    [
      Input {
        output_reference: OutputReference {
          transaction_id: #"6b3714de8c991e2af1223c21631aab265cb743d191c2eeeca31f15a1cbaffe68",
          output_index: 0,
        },
        output: Output {
          address: from_script(connection_token.policy_id),
          value: from_asset(
            connection_token.policy_id,
            connection_token.name,
            1,
          ),
          datum: InlineDatum(connection_datum),
          reference_script: None,
        },
      },
      Input {
        output_reference: OutputReference {
          transaction_id: #"13622c6d8face49863462058aff580d05a9c6feef7d5b54581bb9d81c19feaba",
          output_index: 0,
        },
        output: Output {
          address: from_script(client_token.policy_id),
          value: from_asset(client_token.policy_id, client_token.name, 1),
          datum: InlineDatum(client_datum),
          reference_script: None,
        },
      },
    ]

  let packet =
    Packet {
      sequence: 1,
      source_port: "vesseloracle",
      source_channel: "channel-1",
      destination_port: "port-100",
      destination_channel: "channel-0",
      data: #"7b22696d6f223a2239353235333338222c227473223a313734313235353632322c22746f74616c53616d706c6573223a382c226574614f75746c69657273223a312c226574614d65616e436c65616e6564223a313732373639303339342c226574614d65616e416c6c223a313732373638373633332c22657461537464436c65616e6564223a34342c22657461537464416c6c223a313031372c22646570706f7274223a22494e4e5341222c22646570706f727453636f7265223a38377d",
      timeout_height: Height { revision_number: 1, revision_height: 2406 },
      timeout_timestamp: 1741267642158681752,
    }
  let spend_channel_redeemer: Redeemer =
    RecvPacket {
      packet,
      proof_commitment: merkle_proof,
      proof_height: Height { revision_height: 2709, revision_number: 0 },
    }
  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: "channel-0",
        packet_data: packet.data,
        acknowledgement: acknowledgement_mod.new_result_acknowledgement("AQ=="),
        data: OtherModuleData,
      },
    )

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Mint(verify_proof_policy_id), mint_verifying_proof_redeemer),
      Pair(Spend(module_input.output_reference), module_redeemer),
      Pair(Spend(spend_channel_input.output_reference), spend_channel_redeemer),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      reference_inputs,
      outputs,
      redeemers,
      validity_range,
      mint: from_asset(recv_packet_policy_id, "", 1),
    }

  recv_packet.recv_packet.mint(
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    verify_proof_policy_id,
    host_state_nft_policy_id,
    channel_token,
    recv_packet_policy_id,
    transaction,
  )
}
