use aiken/crypto.{VerificationKeyHash}
use ibc/core/ics_025_handler_interface/host_state.{ModuleRegistration}

pub type HostStateRedeemer {
  CreateClient {
    client_state_siblings: List<ByteArray>,
    consensus_state_siblings: List<ByteArray>,
    // Sibling hashes for the reserved per-client live-connection count,
    // initialized to canonical CBOR zero in the same root transition.
    client_connection_count_siblings: List<ByteArray>,
  }
  CreateConnection {
    connection_siblings: List<ByteArray>,
    // Authenticated old count used for old -> old + 1.
    client_connection_count: Int,
    // Sibling hashes for incrementing the owning client's live-connection
    // count in the same root transition.
    client_connection_count_siblings: List<ByteArray>,
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
  PruneTerminalClient {
    // One fixed-depth deletion witness for every consensus-state leaf removed
    // in this bounded pruning transaction.
    removed_consensus_state_siblings: List<List<ByteArray>>,
  }
  BeginConnectionRetirement
  BeginChannelAbandonment
  ReclaimChannel {
    reclaim_to: VerificationKeyHash,
    // Both the standard Closed path (which retains channel/recv) and the local
    // abandoned-handshake path (which deletes them) use this single typed ABI.
    channel_siblings: List<ByteArray>,
    next_sequence_send_siblings: List<ByteArray>,
    next_sequence_recv_siblings: List<ByteArray>,
    next_sequence_ack_siblings: List<ByteArray>,
  }
  ReclaimConnection {
    reclaim_to: VerificationKeyHash,
    connection_siblings: List<ByteArray>,
    // Authenticated positive old count used for old -> old - 1.
    client_connection_count: Int,
    client_connection_count_siblings: List<ByteArray>,
  }
  ReclaimClient {
    reclaim_to: VerificationKeyHash,
    client_state_siblings: List<ByteArray>,
    // The bounded pruning path leaves one latest consensus state for the final
    // reclaim transaction to authenticate and delete.
    consensus_state_siblings: List<ByteArray>,
    client_connection_count_siblings: List<ByteArray>,
  }
  SealShutdown
  ReclaimHostState { reclaim_to: VerificationKeyHash }
  // Advance an application-owned module root without changing the canonical
  // IBC commitment. Appending this constructor preserves every existing wire
  // index.
  UpdateModuleState { port_id: ByteArray }
  // Reclaim one fully settled registered module during shutdown. The committed
  // `ports/{port_id}` leaf is intentionally retained as immutable history.
  ReclaimModule { port_id: ByteArray }
}
