use aiken/collection/pairs
use cardano/assets.{from_asset}
use cardano/transaction.{Mint, Redeemer, ScriptPurpose, Spend, Transaction}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyNonMembership,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{PrunePacketHistory}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order as channel_order_mod
use ibc/core/ics_004/types/state as channel_state_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof} as merkle
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/prune_packet_history
use spending_channel/spending_channel_fixture.{setup}

const sequence = 7

const receipt = ""

const acknowledgement = "acknowledgement commitment"

type Mutation {
  Valid
  AtCapacity
  WrongProofPath
  WrongSequence
  MissingReceipt
  MissingAcknowledgement
  FloorAboveProof
  MaximumAboveProof
  OrderedChannel
  UnrelatedCommitmentMutation
}

fn packet_entries(first: Int, last: Int, value: ByteArray) {
  if first > last {
    []
  } else {
    [Pair(first, value), ..packet_entries(first + 1, last, value)]
  }
}

fn check(mutation: Mutation) -> Bool {
  let mock_data = setup()
  let proof_height = Height { revision_number: 1, revision_height: 13 }
  let floor =
    when mutation is {
      FloorAboveProof -> Height { revision_number: 2, revision_height: 1 }
      _ -> Height { revision_number: 1, revision_height: 5 }
    }
  let maximum =
    when mutation is {
      MaximumAboveProof -> Height { revision_number: 1, revision_height: 14 }
      _ -> Height { revision_number: 1, revision_height: 10 }
    }
  let ordering =
    when mutation is {
      OrderedChannel -> channel_order_mod.Ordered
      _ -> channel_order_mod.Unordered
    }
  let receipts =
    when mutation is {
      AtCapacity ->
        packet_entries(
          1,
          channel_datum_mod.max_packet_entries_per_channel / 2,
          receipt,
        )
      MissingReceipt -> []
      _ -> [Pair(sequence, receipt)]
    }
  let acknowledgements =
    when mutation is {
      AtCapacity ->
        packet_entries(
          1,
          channel_datum_mod.max_packet_entries_per_channel / 2,
          acknowledgement,
        )
      MissingAcknowledgement -> []
      _ -> [Pair(sequence, acknowledgement)]
    }
  let commitments =
    when mutation is {
      AtCapacity -> []
      _ -> [Pair(1, "unrelated outbound commitment")]
    }

  let channel =
    Channel {
      state: channel_state_mod.Open,
      ordering,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "ics20-1",
    }
  let input_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: 2,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: commitments,
        packet_receipt: receipts,
        packet_acknowledgement: acknowledgements,
        minimum_receive_proof_height: floor,
        maximum_receive_proof_height: maximum,
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }
  let valid_output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        packet_receipt: pairs.delete_first(receipts, sequence),
        packet_acknowledgement: pairs.delete_first(acknowledgements, sequence),
        minimum_receive_proof_height: proof_height,
      },
    }
  let output_datum =
    when mutation is {
      UnrelatedCommitmentMutation ->
        ChannelDatum {
          ..valid_output_datum,
          state: ChannelDatumState {
            ..valid_output_datum.state,
            packet_commitment: [],
          },
        }
      _ -> valid_output_datum
    }

  let channel_input =
    test_utils.build_channel_input(input_datum, mock_data.channel_token)
  expect
    if mutation == AtCapacity {
      channel_datum_mod.packet_entry_count(input_datum.state) == channel_datum_mod.max_packet_entries_per_channel
    } else {
      True
    }
  let channel_output =
    test_utils.build_channel_output(output_datum, mock_data.channel_token)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(mock_data.client_input.output)
  expect Some(consensus_state) =
    pairs.get_first(client_datum.state.consensus_states, proof_height)
  expect Some(processed_time) =
    pairs.get_first(client_datum.state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(client_datum.state.processed_heights, proof_height)

  let redeemer_sequence =
    when mutation is {
      WrongSequence -> sequence + 1
      _ -> sequence
    }
  let proof_sequence =
    when mutation is {
      WrongProofPath -> sequence + 1
      _ -> redeemer_sequence
    }
  let proof = MerkleProof { proofs: [] }
  let proof_path =
    merkle.apply_prefix(
      connection_datum.state.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            channel.counterparty.port_id,
            channel.counterparty.channel_id,
            proof_sequence,
          ),
        ],
      ),
    )
  let verify_proof_redeemer: Redeemer =
    VerifyNonMembership {
      cs: client_datum.state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      processed_time,
      processed_height,
      delay_time_period: connection_datum.state.delay_period,
      delay_block_period: verify_mod.get_block_delay(connection_datum.state),
      proof,
      path: proof_path,
    }
  let channel_redeemer: Redeemer =
    PrunePacketHistory {
      sequence: redeemer_sequence,
      proof_commitment_absence: proof,
      proof_height,
    }
  let marker_redeemer: Redeemer = mock_data.channel_token
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(channel_input.output_reference), channel_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
      Pair(Mint(mock_data.prune_packet_history_policy_id), marker_redeemer),
    ]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [channel_input],
      reference_inputs: [mock_data.connection_input, mock_data.client_input],
      outputs: [channel_output],
      redeemers,
      validity_range: mock_data.validity_range,
      mint: from_asset(mock_data.prune_packet_history_policy_id, "", 1),
    }

  prune_packet_history.prune_packet_history.mint(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.channel_token,
    mock_data.prune_packet_history_policy_id,
    transaction,
  )
}

test prune_packet_history_accepts_valid_commitment_absence_transition() {
  check(Valid)
}

test prune_packet_history_succeeds_at_capacity_boundary() {
  check(AtCapacity)
}

test prune_packet_history_rejects_wrong_commitment_path() {
  !check(WrongProofPath)
}

test prune_packet_history_rejects_wrong_sequence() {
  !check(WrongSequence)
}

test prune_packet_history_rejects_missing_local_receipt() {
  !check(MissingReceipt)
}

test prune_packet_history_rejects_missing_local_acknowledgement() {
  !check(MissingAcknowledgement)
}

test prune_packet_history_rejects_proof_below_floor_revision() {
  !check(FloorAboveProof)
}

test prune_packet_history_rejects_proof_below_receive_high_water() {
  !check(MaximumAboveProof)
}

test prune_packet_history_rejects_ordered_channel() {
  !check(OrderedChannel)
}

test prune_packet_history_rejects_unrelated_commitment_mutation() {
  !check(UnrelatedCommitmentMutation)
}
