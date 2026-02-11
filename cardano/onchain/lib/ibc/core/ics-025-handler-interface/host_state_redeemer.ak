pub type HostStateRedeemer {
  CreateClient {
    client_state_siblings: List<ByteArray>,
    consensus_state_siblings: List<ByteArray>,
  }
  CreateConnection {
    connection_siblings: List<ByteArray>,
  }
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
    port: Int,
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
    // Sibling hashes for consensus state deletions.
    //
    // The spend_client validator may prune or expire old consensus states.
    // Each removed consensus state is a deletion in the commitment tree.
    //
    // This is a list-of-lists:
    // - outer list: one entry per removed consensus state (in input order)
    // - inner list: the `merkle_depth_bits` sibling hashes for that key update
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
}
