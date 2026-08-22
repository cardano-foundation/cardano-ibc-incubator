use aiken/builtin
use aiken/cbor
use aiken/collection/pairs
use aiken/interval
use cardano/assets.{add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, Redeemer, ScriptPurpose, Spend, Transaction,
}
use host_state_stt
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyNonMembership, VerifyProofRedeemer,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{
  ChannelActive, ChannelDatum, ChannelDatumState,
}
use ibc/core/ics_004/channel_redeemer.{PrunePacketHistory, SpendChannelRedeemer}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order as channel_order
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, LeafOp, NonExistenceProof,
}
use ibc/core/ics_023_vector_commitments/merkle.{
  MerklePath, MerkleProof, MerkleRoot,
} as merkle
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, empty_ibc_state_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HandlePacket, HostStateRedeemer,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/bits
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel
use spending_channel/prune_packet_history
use spending_channel/spending_channel_fixture.{setup}
use verifying_proof

const sequence = 1

const acknowledgement = "acknowledgement commitment"

type Mutation {
  Valid
  VerifyPathSequenceMismatch
}

fn repeat(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat(value, count - 1)]
  }
}

fn empty_siblings() -> List<ByteArray> {
  repeat(
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

/// Build a sparse-tree witness for a missing target key in a one-leaf tree.
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

/// Construct a genuine ICS-23 absence proof whose right-neighbor range covers
/// packet commitment keys. Keeping this fixture synthetic avoids copying a
/// chain-specific proof blob while still executing the real proof verifier.
fn commitment_absence_proof(
  commitment_key: ByteArray,
) -> (MerkleProof, MerkleRoot) {
  let right_neighbor =
    ExistenceProof {
      key: #"ff",
      value: #"01",
      leaf: LeafOp {
        hash: 1,
        prehash_key: 0,
        prehash_value: 1,
        length: 1,
        prefix: #"000202",
      },
      path: [],
    }
  let absence_step =
    CommitmentProof {
      proof: CommitmentProof_Nonexist {
        non_exist: NonExistenceProof {
          key: commitment_key,
          left: ExistenceProof {
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
          right: right_neighbor,
        },
      },
    }
  let subtree_root = proof.calculate(absence_step)
  let root_step =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          key: "ibc",
          value: subtree_root,
          leaf: LeafOp {
            hash: 1,
            prehash_key: 0,
            prehash_value: 1,
            length: 1,
            prefix: #"00",
          },
          path: [],
        },
      },
    }

  (
    MerkleProof { proofs: [absence_step, root_step] },
    MerkleRoot { hash: proof.calculate(root_step) },
  )
}

fn check_composed_prune(mutation: Mutation) -> Bool {
  let mock = setup()
  let proof_height = Height { revision_number: 1, revision_height: 13 }
  let channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_order.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock.connection_id],
      version: "ics20-1",
    }
  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [Pair(sequence, "")],
        packet_acknowledgement: [Pair(sequence, acknowledgement)],
        minimum_receive_proof_height: Height {
          revision_number: 1,
          revision_height: 5,
        },
        maximum_receive_proof_height: Height {
          revision_number: 1,
          revision_height: 10,
        },
      },
      port_id: mock.port_id,
      token: mock.channel_token,
      lifecycle: ChannelActive,
    }
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: [],
        packet_acknowledgement: [],
        minimum_receive_proof_height: proof_height,
      },
    }
  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock.channel_token)
  let channel_output =
    test_utils.build_channel_output(output_channel_datum, mock.channel_token)

  let receipt_key =
    packet_keys.packet_receipt_path(mock.port_id, mock.channel_id, sequence)
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path(
      mock.port_id,
      mock.channel_id,
      sequence,
    )
  let all_empty_siblings = empty_siblings()
  let acknowledgement_insert_siblings =
    siblings_after_single_insert(
      receipt_key,
      cbor.serialise(""),
      acknowledgement_key,
    )
  let root_after_receipt_insert =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      receipt_key,
      "",
      cbor.serialise(""),
      all_empty_siblings,
    )
  let old_root =
    ibc_state_commitment.apply_update(
      root_after_receipt_insert,
      acknowledgement_key,
      "",
      cbor.serialise(acknowledgement),
      acknowledgement_insert_siblings,
    )
  let receipt_delete_siblings =
    siblings_after_single_insert(
      acknowledgement_key,
      cbor.serialise(acknowledgement),
      receipt_key,
    )
  let root_after_receipt_delete =
    ibc_state_commitment.apply_update(
      old_root,
      receipt_key,
      cbor.serialise(""),
      "",
      receipt_delete_siblings,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      root_after_receipt_delete,
      acknowledgement_key,
      cbor.serialise(acknowledgement),
      "",
      all_empty_siblings,
    )

  expect input_host_datum: HostStateDatum =
    validator_utils.get_inline_datum(mock.host_state_input.output)
  let old_host_datum =
    HostStateDatum {
      ..input_host_datum,
      state: HostState { ..input_host_datum.state, ibc_state_root: old_root },
    }
  let new_host_datum =
    HostStateDatum {
      ..old_host_datum,
      state: HostState {
        ..old_host_datum.state,
        version: old_host_datum.state.version + 1,
        ibc_state_root: new_root,
      },
    }
  let host_input =
    Input {
      ..mock.host_state_input,
      output: Output {
        ..mock.host_state_input.output,
        datum: InlineDatum(old_host_datum),
      },
    }
  let host_output =
    Output {
      ..mock.host_state_input.output,
      value: mock.host_state_input.output.value
        |> add("lifecycle packet policy", "ibc_lifecycle", 1),
      datum: InlineDatum(new_host_datum),
    }

  let commitment_key =
    packet_keys.packet_commitment_path(
      channel.counterparty.port_id,
      channel.counterparty.channel_id,
      sequence,
    )
  let (proof_commitment_absence, proof_root) =
    commitment_absence_proof(commitment_key)
  expect original_client_datum: ClientDatum =
    validator_utils.get_inline_datum(mock.client_input.output)
  expect Some(original_consensus_state) =
    pairs.get_first(original_client_datum.state.consensus_states, proof_height)
  let proof_consensus_state =
    ConsensusState { ..original_consensus_state, root: proof_root }
  let client_input =
    test_utils.update_client(
      proof_height,
      proof_consensus_state,
      mock.client_input,
    )
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock.connection_input.output)

  let verify_sequence =
    when mutation is {
      VerifyPathSequenceMismatch -> sequence + 1
      Valid -> sequence
    }
  let verify_path: MerklePath =
    merkle.apply_prefix(
      connection_datum.state.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            channel.counterparty.port_id,
            channel.counterparty.channel_id,
            verify_sequence,
          ),
        ],
      ),
    )
  let channel_redeemer: SpendChannelRedeemer =
    PrunePacketHistory { sequence, proof_commitment_absence, proof_height }
  let host_redeemer: HostStateRedeemer =
    HandlePacket {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: receipt_delete_siblings,
      packet_acknowledgement_siblings: all_empty_siblings,
    }
  let verify_redeemer: VerifyProofRedeemer =
    VerifyNonMembership {
      cs: client_datum.state.client_state,
      cons_state: proof_consensus_state,
      height: proof_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: connection_datum.state.delay_period,
      delay_block_period: verify_mod.get_block_delay(connection_datum.state),
      proof: proof_commitment_absence,
      path: verify_path,
    }
  let channel_redeemer_data: Redeemer = channel_redeemer
  let host_redeemer_data: Redeemer = host_redeemer
  let verify_redeemer_data: Redeemer = verify_redeemer
  let marker_redeemer: Redeemer = mock.channel_token
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(channel_input.output_reference), channel_redeemer_data),
      Pair(Spend(host_input.output_reference), host_redeemer_data),
      Pair(Mint(mock.prune_packet_history_policy_id), marker_redeemer),
      Pair(Mint(mock.verify_proof_policy_id), verify_redeemer_data),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [channel_input, host_input],
      reference_inputs: [mock.connection_input, client_input],
      outputs: [channel_output, host_output],
      redeemers,
      validity_range: interval.between(0, 1_577_923_295_000),
      mint: from_asset(mock.prune_packet_history_policy_id, "", 1)
        |> add(mock.verify_proof_policy_id, "", 1)
        |> add("lifecycle packet policy", "ibc_lifecycle", 1),
    }

  let marker_valid =
    prune_packet_history.prune_packet_history.mint(
      mock.client_minting_policy_id,
      mock.connection_minting_policy_id,
      mock.verify_proof_policy_id,
      mock.channel_token,
      mock.prune_packet_history_policy_id,
      transaction,
    )
  let spending_channel_valid =
    spending_channel.spend_channel.spend(
      mock.chan_open_ack_policy_id,
      mock.chan_open_confirm_policy_id,
      mock.chan_close_init_policy_id,
      mock.chan_close_confirm_policy_id,
      mock.recv_packet_policy_id,
      mock.send_packet_policy_id,
      mock.timeout_packet_policy_id,
      mock.acknowledge_packet_policy_id,
      mock.prune_packet_history_policy_id,
      mock.host_state_nft_policy_id,
      Some(input_channel_datum),
      channel_redeemer,
      channel_input.output_reference,
      transaction,
    )
  let host_state_valid =
    host_state_stt.host_state_stt.spend(
      mock.host_state_nft_policy_id,
      "unused client script hash",
      "unused connection script hash",
      "mock spend channel script hash",
      mock.client_minting_policy_id,
      mock.connection_minting_policy_id,
      mock.channel_token.policy_id,
      "lifecycle creation policy",
      "lifecycle reclamation policy",
      "lifecycle operational policy",
      "lifecycle packet policy",
      None,
      host_redeemer,
      host_input.output_reference,
      transaction,
    )
  let verify_proof_valid =
    verifying_proof.verify_proof.mint(
      verify_redeemer,
      mock.verify_proof_policy_id,
      transaction,
    )

  when mutation is {
    Valid -> and {
        marker_valid?,
        spending_channel_valid?,
        host_state_valid?,
        verify_proof_valid?,
      }
    VerifyPathSequenceMismatch -> and {
        !marker_valid,
        spending_channel_valid?,
        host_state_valid?,
        verify_proof_valid?,
      }
  }
}

test prune_packet_history_composes_all_real_validators() {
  check_composed_prune(Valid)
}

test prune_packet_history_composition_rejects_verify_path_sequence_mismatch() {
  check_composed_prune(VerifyPathSequenceMismatch)
}
