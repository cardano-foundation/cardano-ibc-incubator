use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_025_handler_interface/host_state.{ModuleRegistration}

pub type HostStateRedeemer {
  CreateClient {
    client_state_siblings: List<ByteArray>,
    consensus_state_siblings: List<ByteArray>,
  }
  CreateConnection { connection_siblings: List<ByteArray> }
  CreateChannel {
    // Sibling hashes for the `channelEnds/ports/{portId}/channels/{channelId}` key update.
    channel_siblings: List<ByteArray>,
    // Sibling hashes for the `nextSequenceSend/ports/{portId}/channels/{channelId}` key update.
    next_sequence_send_siblings: List<ByteArray>,
    // Sibling hashes for the `nextSequenceRecv/ports/{portId}/channels/{channelId}` key update.
    next_sequence_recv_siblings: List<ByteArray>,
    // Sibling hashes for the `nextSequenceAck/ports/{portId}/channels/{channelId}` key update.
    next_sequence_ack_siblings: List<ByteArray>,
  }
  BindPort {
    // Exact canonical IBC port identifier used in commitment paths.
    port_id: ByteArray,
    // Immutable module credential and capability tokens for this port.
    registration: ModuleRegistration,
    // Sibling hashes for the `ports/{portId}` key update.
    port_siblings: List<ByteArray>,
  }
  UpdateClient {
    // Sibling hashes for the `clients/{clientId}/clientState` key update.
    client_state_siblings: List<ByteArray>,
    // Sibling hashes for the `clients/{clientId}/consensusStates/{height}` key update.
    //
    // This is only used when the UpdateClient transition adds a new consensus state.
    // For updates that do not add a consensus state (e.g., misbehaviour), this should
    // be an empty list.
    consensus_state_siblings: List<ByteArray>,
    // Reserved wire field. Normal updates archive the previous state without
    // deleting its commitment, so this must be empty.
    removed_consensus_state_siblings: List<List<ByteArray>>,
  }
  UpdateConnection {
    // Sibling hashes for the `connections/{id}` key update.
    connection_siblings: List<ByteArray>,
  }
  UpdateChannel {
    // Sibling hashes for the `channelEnds/ports/{portId}/channels/{channelId}` key update.
    channel_siblings: List<ByteArray>,
  }
  HandlePacket {
    // Sibling hashes for the `channelEnds/ports/{portId}/channels/{channelId}` key update.
    //
    // Most packet operations do not change the channel end, but ordered timeouts do.
    channel_siblings: List<ByteArray>,
    // Sibling hashes for the `nextSequenceSend/ports/{portId}/channels/{channelId}` key update.
    next_sequence_send_siblings: List<ByteArray>,
    // Sibling hashes for the `nextSequenceRecv/ports/{portId}/channels/{channelId}` key update.
    next_sequence_recv_siblings: List<ByteArray>,
    // Sibling hashes for the `nextSequenceAck/ports/{portId}/channels/{channelId}` key update.
    next_sequence_ack_siblings: List<ByteArray>,
    // Sibling hashes for the `commitments/ports/{portId}/channels/{channelId}/sequences/{sequence}` key update.
    packet_commitment_siblings: List<ByteArray>,
    // Sibling hashes for the `receipts/ports/{portId}/channels/{channelId}/sequences/{sequence}` key update.
    packet_receipt_siblings: List<ByteArray>,
    // Sibling hashes for the `acks/ports/{portId}/channels/{channelId}/sequences/{sequence}` key update.
    packet_acknowledgement_siblings: List<ByteArray>,
  }
  EnterShutdown {
    // POSIX time in milliseconds after which deployment infrastructure can be
    // reclaimed by the trusted deployer.
    grace_period_end: Int,
  }
  FinalizeShutdown
  // Re-create the HostState UTxO without changing the IBC commitment. This
  // provides one proof anchor per Cardano epoch when no ordinary IBC state
  // transition occurs.
  Heartbeat
  // Delete one expired archived state. Its authentication NFT must be burnt
  // by the client policy in the same transaction.
  PruneConsensusState {
    client_token: AuthToken,
    height: Height,
    consensus_state_siblings: List<ByteArray>,
  }
}
