use aiken/dict
use ibc/client/cardano_client/protos/cardano_pb.{
  AnyCardanoClientState, CardanoClientState,
}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/params
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/math

pub fn verify_connection_state(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  counterparty_connection: ConnectionEnd,
  proof: MerkleProof,
  proof_height: Height,
) -> Bool {
  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )
  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height.compare)
      |> dict.get(proof_height)
  client_state.verify_membership(
    client_datum_state.client_state,
    consensus_state,
    proof_height,
    0,
    0,
    proof,
    merkle_path,
    connection_pb.marshal_for_connection_end(
      Some(
        connection_end.convert_to_connection_end_proto(counterparty_connection),
      ),
    ),
  )
}

pub fn verify_client_state(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  counterparty_client_state: CardanoClientState,
  proof: MerkleProof,
  proof_height: Height,
) -> Bool {
  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [client_keys.full_client_state_path(connection.counterparty.client_id)],
      ),
    )
  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height.compare)
      |> dict.get(proof_height)
  client_state.verify_membership(
    client_datum_state.client_state,
    consensus_state,
    proof_height,
    0,
    0,
    proof,
    merkle_path,
    cardano_pb.marshal_for_any_client_state(
      Some(
        AnyCardanoClientState {
          type_url: "/ibc.clients.cardano.v1.ClientState",
          value: Some(counterparty_client_state),
        },
      ),
    ),
  )
}

pub fn verify_channel_state(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  port_id: ByteArray,
  channel_id: ByteArray,
  proof: MerkleProof,
  proof_height: Height,
  channel: Channel,
) -> Bool {
  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path([channel_keys.channel_path(port_id, channel_id)]),
    )
  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height.compare)
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

pub fn verify_packet_commitment(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  proof_height: Height,
  proof: MerkleProof,
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
  commitment_bytes: ByteArray,
) -> Bool {
  let time_delay = connection.delay_period
  let block_delay = get_block_delay(connection)
  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [packet_keys.packet_commitment_path(port_id, channel_id, sequence)],
      ),
    )
  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height.compare)
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

pub fn verify_packet_acknowledgement(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  proof_height: Height,
  proof: MerkleProof,
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
  acknowledgement: ByteArray,
) -> Bool {
  let time_delay = connection.delay_period
  let block_delay = get_block_delay(connection)
  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [packet_keys.packet_acknowledgement_path(port_id, channel_id, sequence)],
      ),
    )

  expect Some(consensus_state) =
    dict.from_list(client_datum_state.consensus_states, height.compare)
      |> dict.get(proof_height)

  let commit_ack = acknowledgement_mod.commit_acknowledgement(acknowledgement)

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

pub fn verify_packet_receipt_absence(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  proof_height: Height,
  proof: MerkleProof,
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
) -> Bool {
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
    dict.from_list(client_datum_state.consensus_states, height.compare)
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

pub fn get_block_delay(connection: ConnectionEnd) -> Int {
  let expected_time_per_block = params.max_expected_time_per_block
  let time_delay = connection.delay_period
  math.ceil_divide_uinteger(time_delay, expected_time_per_block)
}

pub fn verify_next_sequence_recv(
  _client_datum_state: ClientDatumState,
  _connection: ConnectionEnd,
  _proof_height: Height,
  _proof: MerkleProof,
  _port_id: ByteArray,
  _channel_id: ByteArray,
  _next_sequence_recv: Int,
) -> Bool {
  True
}
