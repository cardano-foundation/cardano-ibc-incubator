// IBC Host State - Single Token Thread (STT) Validator
//
// This validator enforces the Single Token Thread pattern for IBC host state:
// 1. Exactly ONE UTXO with the IBC Host State NFT exists at any time
// 2. State updates MUST spend the old UTXO and create a new one with the same NFT
// 3. Version MUST increment monotonically (forward-only progression)
// 4. State transitions MUST be valid for the operation type
//
// Security properties:
// - Canonical state: Only one valid state exists at any height
// - No rollback: Version monotonicity prevents replaying old state
// - Type safety: Redeemer specifies operation, validator checks validity
// - Auditability: NFT provides complete state history

	use aiken/collection/list
	use aiken/collection/pairs
	use aiken/cbor
	use aiken/crypto.{Blake2b_224, Hash, Script}
	use aiken/primitive/bytearray
	use ibc/auth.{AuthToken}
	use cardano/assets.{AssetName, PolicyId, quantity_of}
		use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
		use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
		use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
		use ibc/client/ics_007_tendermint_client/height.{Height}
			use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
			use ibc/core/ics_003_connection_semantics/types/keys as conn_id_keys
			use ibc/core/ics_004/channel_datum.{ChannelDatum}
			use ibc/core/ics_004/types/keys as chan_id_keys
			use ibc/core/ics_005/types/keys as port_id_keys
			use ibc/core/ics_024_host_requirements/client_keys
			use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
			use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
			use ibc/core/ics_024_host_requirements/packet_keys
			use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
			use ibc/core/ics_025_handler_interface/ibc_state_commitment
			use ibc/core/ics_025_handler_interface/host_state.{
			  HostState, HostStateDatum, host_state_token_name, validate_bind_port,
			  validate_create_channel, validate_create_client, validate_create_connection,
			  validate_update_only_root,
		}
		use ibc/utils/string as string_utils
		use ibc/utils/validator_utils

/// Redeemer for HostState STT operations
	pub type HostStateRedeemer {
	  /// Create a new IBC client
	  CreateClient {
	    // Sibling hashes for the `clients/{id}/clientState` key update.
	    client_state_siblings: List<ByteArray>,
	    // Sibling hashes for the `clients/{id}/consensusStates/{height}` key update.
	    consensus_state_siblings: List<ByteArray>,
	  }
	  /// Create a new IBC connection
	  CreateConnection {
	    // Sibling hashes for the `connections/{id}` key update.
	    connection_siblings: List<ByteArray>,
	  }
	  /// Create a new IBC channel
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
			  /// Bind a port.
			  ///
			  /// This adds a committed `ports/{portId}` entry to the HostState root.
			  /// The `portId` format is `port-{n}` (see `ics-005/types/keys.ak`).
			  BindPort {
			    port: Int,
			    // Sibling hashes for the `ports/{portId}` key update.
			    port_siblings: List<ByteArray>,
			  }
			  /// Update client state (consensus update, misbehaviour, upgrade)
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
	  /// Update connection state (handshake continuation)
	  UpdateConnection {
	    // Sibling hashes for the `connections/{id}` key update.
	    connection_siblings: List<ByteArray>,
	  }
	  /// Update channel state (handshake continuation)
	  UpdateChannel {
	    // Sibling hashes for the `channelEnds/ports/{portId}/channels/{channelId}` key update.
	    channel_siblings: List<ByteArray>,
	  }
	  /// Send/receive/ack/timeout IBC packets
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

/// Find the HostState UTXO input being spent
/// 
/// Returns the input that contains the IBC Host State NFT
fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      let quantity =
        quantity_of(
          input.output.value,
          nft_policy,
          host_state_token_name,
        )
      quantity == 1
    },
  )
}

/// Find the HostState UTXO output being created
/// 
/// Returns the output that contains the IBC Host State NFT
fn find_host_state_output(
  outputs: List<Output>,
  nft_policy: PolicyId,
) -> Option<Output> {
  list.find(
    outputs,
    fn(output) {
          let quantity =
            quantity_of(output.value, nft_policy, host_state_token_name)
          quantity == 1
    },
  )
}

/// Find an input that carries a specific auth token.
///
/// We use this to locate the "state UTxO" for an IBC object (connection/channel)
/// during an update transaction, without relying on address parsing.
fn find_input_with_auth_token(
  inputs: List<Input>,
  token: AuthToken,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      quantity_of(input.output.value, token.policy_id, token.name) == 1
    },
  )
}

/// Derive a `07-tendermint-{N}` identifier from a client token name.
///
/// Client auth tokens are generated with `auth.generate_token_name(...)`, which
/// appends the decimal sequence number as a postfix.
///
/// The on-chain code needs the IBC client identifier form for the ICS-24 store key.
fn client_id_from_token_name(token_name: AssetName) -> ByteArray {
  let sequence = auth.extract_token_sequence(token_name)
  "07-tendermint-" |> bytearray.concat(sequence)
}

/// Derive a `connection-{N}` identifier from a connection token name.
///
/// Off-chain, connection tokens are named as `"connection" ++ decimal(N)`.
/// The on-chain code needs the `connection-{N}` form for the ICS-24 store key.
fn connection_id_from_token_name(token_name: AssetName) -> ByteArray {
  let prefix = "connection"
  expect bytearray.length(token_name) > bytearray.length(prefix)
  expect bytearray.take(token_name, bytearray.length(prefix)) == prefix

  let sequence = bytearray.drop(token_name, bytearray.length(prefix))
  sequence |> conn_id_keys.format_connection_identifier()
}

/// Derive a `channel-{N}` identifier from a channel token name.
///
/// Off-chain, channel tokens are named as `"channel" ++ decimal(N)`.
/// The on-chain code needs the `channel-{N}` form for the ICS-24 store key.
fn channel_id_from_token_name(token_name: AssetName) -> ByteArray {
  let prefix = "channel"
  expect bytearray.length(token_name) > bytearray.length(prefix)
  expect bytearray.take(token_name, bytearray.length(prefix)) == prefix

  let sequence = bytearray.drop(token_name, bytearray.length(prefix))
  sequence |> chan_id_keys.format_channel_identifier()
}

/// Decode HostStateDatum from inline datum
fn decode_host_state_datum(output: Output) -> HostStateDatum {
  expect InlineDatum(datum) = output.datum
  expect decoded_datum: HostStateDatum = datum
  decoded_datum
}

/// Enforce that `ibc_state_root` is updated correctly for CreateClient.
///
/// In plain terms:
/// - The new HostState datum is only accepted if its `ibc_state_root` equals
///   the old root with exactly the two CreateClient key updates applied.
fn validate_create_client_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  outputs: List<Output>,
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  client_state_siblings: List<ByteArray>,
  consensus_state_siblings: List<ByteArray>,
) -> Bool {
  // Find the newly created client output.
  //
  // `mint_client_stt` enforces there is exactly one client output for CreateClient,
  // so we require exactly one here too.
  expect [client_output] =
    outputs |> transaction.find_script_outputs(spend_client_script_hash)

  // Decode the client datum so we can derive the exact state bytes that must be
  // committed into the Merkle root.
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_output)

  // Derive the client identifier from the HostState sequence.
  //
  // This matches the off-chain convention: `07-tendermint-{sequence}`.
  let client_id =
    "07-tendermint-"
      |> bytearray.concat(string_utils.int_to_string(old_datum.state.next_client_sequence))

  // Commitment keys (IBC paths).
  let client_state_key = client_keys.full_client_state_path(client_id)

  // The initial consensus state is stored at the client's latest height.
  let latest_height = client_datum.state.client_state.latest_height
  let consensus_height = string_utils.int_to_string(latest_height.revision_height)
  let consensus_state_key =
    client_keys.full_client_consensus_state_path(client_id, consensus_height)

  // Commitment values.
  //
  // We commit the CBOR serialization of the on-chain types. The Gateway must
  // use the same encoding when it computes the update witnesses.
  let client_state_value = cbor.serialise(client_datum.state.client_state)

  // `is_initialized_valid` guarantees there is exactly one consensus state and
  // its key equals `latest_height`, so we can require a single value here.
  expect [consensus_state] =
    pairs.get_all(client_datum.state.consensus_states, latest_height)
  let consensus_state_value = cbor.serialise(consensus_state)

  // Apply the two updates in order, starting from the old root.
  //
  // For a newly created client, both keys were previously "empty", so we use
  // the empty bytearray as the old value.
  let root_after_client_state =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      client_state_key,
      "",
      client_state_value,
      client_state_siblings,
    )

  let root_after_consensus_state =
    ibc_state_commitment.apply_update(
      root_after_client_state,
      consensus_state_key,
      "",
      consensus_state_value,
      consensus_state_siblings,
    )

  root_after_consensus_state == new_datum.state.ibc_state_root
}

/// Apply a list of consensus state deletions to the commitment root.
///
/// Why this exists:
/// - The `spend_client` validator may prune old consensus states (size bound)
///   and/or drop expired consensus states (safety).
/// - Each removed consensus state must also be removed from the `ibc_state_root`
///   commitment tree, otherwise proofs become inconsistent.
///
/// How we make this verifiable:
/// - The HostState redeemer carries one sibling list per removed consensus state.
/// - On-chain we compute which consensus states were removed by comparing the
///   input and output client datums, then apply the deletions in that order.
fn apply_removed_consensus_state_updates(
  current_root: ByteArray,
  client_id: ByteArray,
  removed_pairs: Pairs<Height, ConsensusState>,
  siblings_lists: List<List<ByteArray>>,
) -> ByteArray {
  when removed_pairs is {
    [] -> {
      // No removed keys means we also expect no witnesses.
      expect siblings_lists == []
      current_root
    }
    [Pair(height, consensus_state), ..rest_pairs] -> {
      // Each removed consensus state must have a corresponding sibling witness.
      expect [siblings, ..rest_siblings] = siblings_lists

      // The ICS-24 key uses only `revision_height` as the path component today.
      let height_str = string_utils.int_to_string(height.revision_height)
      let consensus_key = client_keys.full_client_consensus_state_path(client_id, height_str)

      // Commitment values are always CBOR-serialized before being committed.
      let old_value = cbor.serialise(consensus_state)

      // Deletion is represented by the empty bytearray.
      let next_root =
        ibc_state_commitment.apply_update(
          current_root,
          consensus_key,
          old_value,
          "",
          siblings,
        )

      apply_removed_consensus_state_updates(next_root, client_id, rest_pairs, rest_siblings)
    }
  }
}

/// Enforce that `ibc_state_root` is updated correctly for UpdateClient.
///
/// In plain terms:
/// - The new HostState datum is only accepted if its `ibc_state_root` equals
///   the old root with exactly the client update key changes applied.
///
/// What can change in a valid UpdateClient transition:
/// - `clients/{clientId}/clientState` is updated (always)
/// - one new consensus state may be added at `clients/{clientId}/consensusStates/{height}`
/// - some old consensus states may be removed (expiry/pruning)
fn validate_update_client_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  client_state_siblings: List<ByteArray>,
  consensus_state_siblings: List<ByteArray>,
  removed_consensus_state_siblings: List<List<ByteArray>>,
) -> Bool {
  // Find the updated client output.
  //
  // `spend_client` enforces there is exactly one client output in this transaction,
  // so we require exactly one here too.
  expect [client_output] =
    outputs |> transaction.find_script_outputs(spend_client_script_hash)

  expect client_output_datum: ClientDatum =
    validator_utils.get_inline_datum(client_output)

  // Identify which client is being updated.
  let client_id = client_id_from_token_name(client_output_datum.token.name)

  // Find the input client UTxO by looking for the same auth token.
  expect Some(client_input) =
    find_input_with_auth_token(inputs, client_output_datum.token)

  expect client_input_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)

  // 1) Apply the clientState update.
  let client_state_key = client_keys.full_client_state_path(client_id)

  let old_client_state_value = cbor.serialise(client_input_datum.state.client_state)
  let new_client_state_value = cbor.serialise(client_output_datum.state.client_state)

  let root_after_client_state =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      client_state_key,
      old_client_state_value,
      new_client_state_value,
      client_state_siblings,
    )

  // 2) Apply any consensus state deletions (pruning / expiry).
  let input_cons_states = client_input_datum.state.consensus_states
  let output_cons_states = client_output_datum.state.consensus_states

  let removed_consensus_pairs =
    list.filter(
      input_cons_states,
      fn(pair) { !pairs.has_key(output_cons_states, pair.1st) },
    )

  let root_after_removed =
    apply_removed_consensus_state_updates(
      root_after_client_state,
      client_id,
      removed_consensus_pairs,
      removed_consensus_state_siblings,
    )

  // 3) Apply the new consensus state insertion (if any).
  //
  // Misbehaviour updates do not add a new consensus state.
  let added_consensus_pairs =
    list.filter(
      output_cons_states,
      fn(pair) { !pairs.has_key(input_cons_states, pair.1st) },
    )

  let root_final =
    when added_consensus_pairs is {
      [] -> root_after_removed
      [Pair(height, consensus_state)] -> {
        let height_str = string_utils.int_to_string(height.revision_height)
        let consensus_key = client_keys.full_client_consensus_state_path(client_id, height_str)
        let new_value = cbor.serialise(consensus_state)

        ibc_state_commitment.apply_update(
          root_after_removed,
          consensus_key,
          "",
          new_value,
          consensus_state_siblings,
        )
      }
      _ -> fail @"UpdateClient should add at most one consensus state"
    }

  root_final == new_datum.state.ibc_state_root
}

/// Enforce that `ibc_state_root` is updated correctly for CreateConnection.
///
/// In plain terms:
/// - The new HostState datum is only accepted if its `ibc_state_root` equals
///   the old root with exactly the CreateConnection key update applied.
	fn validate_create_connection_root(
	  old_datum: HostStateDatum,
	  new_datum: HostStateDatum,
	  outputs: List<Output>,
	  spend_connection_script_hash: Hash<Blake2b_224, Script>,
	  connection_siblings: List<ByteArray>,
) -> Bool {
  // Find the newly created connection output.
  //
  // `mint_connection_stt` enforces there is exactly one connection output for CreateConnection,
  // so we require exactly one here too.
  expect [connection_output] =
    outputs |> transaction.find_script_outputs(spend_connection_script_hash)

  // Decode the connection datum so we can derive the exact state bytes that must be
  // committed into the Merkle root.
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_output)

  // Derive the connection identifier from the HostState sequence.
  //
  // This matches the off-chain convention: `connection-{sequence}`.
  let connection_id =
    string_utils.int_to_string(old_datum.state.next_connection_sequence)
      |> conn_id_keys.format_connection_identifier()

  // Commitment key (IBC path).
  let connection_key = host_connection_keys.connection_path(connection_id)

  // Commitment value.
  //
  // We commit the CBOR serialization of the on-chain `ConnectionEnd`.
  // The Gateway must use the same encoding when it computes the update witness.
  let connection_value = cbor.serialise(connection_datum.state)

  let root_after_connection =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      connection_key,
      "",
      connection_value,
      connection_siblings,
    )

	  root_after_connection == new_datum.state.ibc_state_root
	}

	/// Enforce that `ibc_state_root` is updated correctly for CreateChannel.
	///
	/// In plain terms:
	/// - The new HostState datum is only accepted if its `ibc_state_root` equals
	///   the old root with the CreateChannel key updates applied.
	fn validate_create_channel_root(
	  old_datum: HostStateDatum,
	  new_datum: HostStateDatum,
	  outputs: List<Output>,
	  spend_channel_script_hash: Hash<Blake2b_224, Script>,
	  channel_siblings: List<ByteArray>,
	  next_sequence_send_siblings: List<ByteArray>,
	  next_sequence_recv_siblings: List<ByteArray>,
	  next_sequence_ack_siblings: List<ByteArray>,
	) -> Bool {
	  // Find the newly created channel output.
	  //
	  // `mint_channel_stt` enforces there is exactly one channel output for CreateChannel,
	  // so we require exactly one here too.
	  expect [channel_output] =
	    outputs |> transaction.find_script_outputs(spend_channel_script_hash)

	  // Decode the channel datum so we can derive the exact state bytes that must be
	  // committed into the Merkle root.
	  expect channel_datum: ChannelDatum =
	    validator_utils.get_inline_datum(channel_output)

	  // Derive the channel identifier from the HostState sequence.
	  //
	  // This matches the off-chain convention: `channel-{sequence}`.
	  let channel_id =
	    string_utils.int_to_string(old_datum.state.next_channel_sequence)
	      |> chan_id_keys.format_channel_identifier()

	  // Commitment keys (IBC paths).
	  let port_id = channel_datum.port_id
	  let channel_key = host_channel_keys.channel_path(port_id, channel_id)
	  let next_sequence_send_key = packet_keys.next_sequence_send_path(port_id, channel_id)
	  let next_sequence_recv_key = packet_keys.next_sequence_recv_path(port_id, channel_id)
	  let next_sequence_ack_key = packet_keys.next_sequence_ack_path(port_id, channel_id)

	  // Commitment values.
	  //
	  // We commit the CBOR serialization of the on-chain types. The Gateway must
	  // use the same encoding when it computes the update witnesses.
	  let channel_value = cbor.serialise(channel_datum.state.channel)
	  let next_sequence_send_value =
	    cbor.serialise(channel_datum.state.next_sequence_send)
	  let next_sequence_recv_value =
	    cbor.serialise(channel_datum.state.next_sequence_recv)
	  let next_sequence_ack_value =
	    cbor.serialise(channel_datum.state.next_sequence_ack)

	  // Apply the 4 updates in order, starting from the old root.
	  //
	  // For a newly created channel, these keys were previously "empty", so we use
	  // the empty bytearray as the old value.
	  let root_after_channel =
	    ibc_state_commitment.apply_update(
	      old_datum.state.ibc_state_root,
	      channel_key,
	      "",
	      channel_value,
	      channel_siblings,
	    )

	  let root_after_next_sequence_send =
	    ibc_state_commitment.apply_update(
	      root_after_channel,
	      next_sequence_send_key,
	      "",
	      next_sequence_send_value,
	      next_sequence_send_siblings,
	    )

	  let root_after_next_sequence_recv =
	    ibc_state_commitment.apply_update(
	      root_after_next_sequence_send,
	      next_sequence_recv_key,
	      "",
	      next_sequence_recv_value,
	      next_sequence_recv_siblings,
	    )

	  let root_after_next_sequence_ack =
	    ibc_state_commitment.apply_update(
	      root_after_next_sequence_recv,
	      next_sequence_ack_key,
	      "",
	      next_sequence_ack_value,
	      next_sequence_ack_siblings,
	    )

		  root_after_next_sequence_ack == new_datum.state.ibc_state_root
		}

/// Enforce that `ibc_state_root` is updated correctly for BindPort.
///
/// In plain terms:
/// - The new HostState datum is only accepted if its `ibc_state_root` equals
///   the old root with exactly the `ports/{portId}` key insertion applied.
fn validate_bind_port_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  port: Int,
  port_siblings: List<ByteArray>,
) -> Bool {
  // Commitment key (IBC path): `ports/{portId}`.
  //
  // The port identifier is a stable Cardano-specific format: `port-{n}`.
  let port_id = port_id_keys.format_port_identifier(port)
  let port_key =
    key_port_prefix
      |> bytearray.concat("/")
      |> bytearray.concat(port_id)

  // Commitment value.
  //
  // We store a non-empty marker to represent "this port is bound".
  // Using the CBOR encoding of the port number itself is deterministic and
  // straightforward to reproduce off-chain.
  let port_value = cbor.serialise(port)

  let root_after_bind =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      port_key,
      "",
      port_value,
      port_siblings,
    )

  root_after_bind == new_datum.state.ibc_state_root
}

	/// Enforce that `ibc_state_root` is updated correctly for UpdateConnection.
	///
	/// In plain terms:
	/// - The new HostState datum is only accepted if its `ibc_state_root` equals
///   the old root with exactly the `connections/{id}` key update applied.
fn validate_update_connection_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  connection_siblings: List<ByteArray>,
) -> Bool {
  // Find the updated connection output.
  //
  // `spend_connection` enforces there is exactly one connection output in this transaction,
  // so we require exactly one here too.
  expect [connection_output] =
    outputs |> transaction.find_script_outputs(spend_connection_script_hash)

  // Decode the output datum so we can:
  // - derive the connection id from its token name
  // - compute the exact CBOR bytes that are committed into the Merkle root
  expect connection_output_datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_output)

  let connection_id = connection_id_from_token_name(connection_output_datum.token.name)
  let connection_key = host_connection_keys.connection_path(connection_id)

  // Find the input connection UTxO by looking for the same auth token.
  expect Some(connection_input) =
    find_input_with_auth_token(inputs, connection_output_datum.token)

  expect connection_input_datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_input.output)

  // Commitment values.
  //
  // We commit the CBOR serialization of the on-chain `ConnectionEnd`.
  // The Gateway must use the same encoding when it computes the update witness.
  let old_connection_value = cbor.serialise(connection_input_datum.state)
  let new_connection_value = cbor.serialise(connection_output_datum.state)

  let root_after_connection =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      connection_key,
      old_connection_value,
      new_connection_value,
      connection_siblings,
    )

  root_after_connection == new_datum.state.ibc_state_root
}

/// Enforce that `ibc_state_root` is updated correctly for UpdateChannel.
///
/// In plain terms:
/// - The new HostState datum is only accepted if its `ibc_state_root` equals
///   the old root with exactly the `channelEnds/ports/{portId}/channels/{channelId}` key
///   update applied.
fn validate_update_channel_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_siblings: List<ByteArray>,
) -> Bool {
  // Find the updated channel output.
  //
  // `spend_channel` enforces there is exactly one channel output in this transaction,
  // so we require exactly one here too.
  expect [channel_output] =
    outputs |> transaction.find_script_outputs(spend_channel_script_hash)

  // Decode the output datum so we can:
  // - derive the channel id from its token name
  // - read the port id (which is part of the IBC path)
  // - compute the exact CBOR bytes that are committed into the Merkle root
  expect channel_output_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  let channel_id = channel_id_from_token_name(channel_output_datum.token.name)
  let port_id = channel_output_datum.port_id
  let channel_key = host_channel_keys.channel_path(port_id, channel_id)

  // Find the input channel UTxO by looking for the same auth token.
  expect Some(channel_input) =
    find_input_with_auth_token(inputs, channel_output_datum.token)

  expect channel_input_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)

  // Commitment values.
  //
  // We commit the CBOR serialization of the on-chain `Channel`.
  // The Gateway must use the same encoding when it computes the update witness.
  let old_channel_value = cbor.serialise(channel_input_datum.state.channel)
  let new_channel_value = cbor.serialise(channel_output_datum.state.channel)

  let root_after_channel =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      channel_key,
      old_channel_value,
      new_channel_value,
      channel_siblings,
    )

  root_after_channel == new_datum.state.ibc_state_root
}

/// Enforce that `ibc_state_root` is updated correctly for packet lifecycle operations.
///
/// In this STT design, packet state lives inside the Channel datum:
/// - sequences (next_sequence_*)
/// - packet_commitment entries
/// - packet_receipt entries
/// - packet_acknowledgement entries
///
/// The HostState `ibc_state_root` must commit to those fields so that the counterparty
/// can verify membership/non-membership proofs about packets.
///
/// This function:
/// 1) locates the channel input and output being updated
/// 2) compares the relevant fields to determine which ICS-24 keys changed
/// 3) applies those key updates to the old root using the sibling witnesses from the redeemer
/// 4) requires the computed root equals the new HostState datum's root
fn validate_handle_packet_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_siblings: List<ByteArray>,
  next_sequence_send_siblings: List<ByteArray>,
  next_sequence_recv_siblings: List<ByteArray>,
  next_sequence_ack_siblings: List<ByteArray>,
  packet_commitment_siblings: List<ByteArray>,
  packet_receipt_siblings: List<ByteArray>,
  packet_acknowledgement_siblings: List<ByteArray>,
) -> Bool {
  // Find the updated channel output.
  expect [channel_output] =
    outputs |> transaction.find_script_outputs(spend_channel_script_hash)

  expect channel_output_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  let channel_id = channel_id_from_token_name(channel_output_datum.token.name)
  let port_id = channel_output_datum.port_id

  // Find the input channel UTxO by looking for the same auth token.
  expect Some(channel_input) =
    find_input_with_auth_token(inputs, channel_output_datum.token)

  expect channel_input_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)

  // Commitment keys (ICS-24 paths).
  let channel_key = host_channel_keys.channel_path(port_id, channel_id)
  let next_sequence_send_key = packet_keys.next_sequence_send_path(port_id, channel_id)
  let next_sequence_recv_key = packet_keys.next_sequence_recv_path(port_id, channel_id)
  let next_sequence_ack_key = packet_keys.next_sequence_ack_path(port_id, channel_id)

  // Start from the old committed root.
  let root0 = old_datum.state.ibc_state_root

  // 1) Channel end update (only for operations that change the channel end, e.g. ordered timeout).
  let root1 =
    if channel_input_datum.state.channel == channel_output_datum.state.channel {
      root0
    } else {
      let old_value = cbor.serialise(channel_input_datum.state.channel)
      let new_value = cbor.serialise(channel_output_datum.state.channel)
      ibc_state_commitment.apply_update(
        root0,
        channel_key,
        old_value,
        new_value,
        channel_siblings,
      )
    }

  // 2) nextSequenceSend update (SendPacket).
  let root2 =
    if channel_input_datum.state.next_sequence_send == channel_output_datum.state.next_sequence_send {
      root1
    } else {
      let old_value = cbor.serialise(channel_input_datum.state.next_sequence_send)
      let new_value = cbor.serialise(channel_output_datum.state.next_sequence_send)
      ibc_state_commitment.apply_update(
        root1,
        next_sequence_send_key,
        old_value,
        new_value,
        next_sequence_send_siblings,
      )
    }

  // 3) nextSequenceRecv update (RecvPacket on ordered channels).
  let root3 =
    if channel_input_datum.state.next_sequence_recv == channel_output_datum.state.next_sequence_recv {
      root2
    } else {
      let old_value = cbor.serialise(channel_input_datum.state.next_sequence_recv)
      let new_value = cbor.serialise(channel_output_datum.state.next_sequence_recv)
      ibc_state_commitment.apply_update(
        root2,
        next_sequence_recv_key,
        old_value,
        new_value,
        next_sequence_recv_siblings,
      )
    }

  // 4) nextSequenceAck update (AcknowledgePacket on ordered channels).
  let root4 =
    if channel_input_datum.state.next_sequence_ack == channel_output_datum.state.next_sequence_ack {
      root3
    } else {
      let old_value = cbor.serialise(channel_input_datum.state.next_sequence_ack)
      let new_value = cbor.serialise(channel_output_datum.state.next_sequence_ack)
      ibc_state_commitment.apply_update(
        root3,
        next_sequence_ack_key,
        old_value,
        new_value,
        next_sequence_ack_siblings,
      )
    }

  // 5) Packet commitment insertion/deletion (SendPacket inserts, Ack/Timeout delete).
  let input_commitments = channel_input_datum.state.packet_commitment
  let output_commitments = channel_output_datum.state.packet_commitment

  let inserted_commitments =
    list.filter(output_commitments, fn(pair) { !pairs.has_key(input_commitments, pair.1st) })

  let removed_commitments =
    list.filter(input_commitments, fn(pair) { !pairs.has_key(output_commitments, pair.1st) })

  let root5 =
    if inserted_commitments != [] {
      // Exactly one insertion is expected in a single packet operation.
      expect removed_commitments == []
      expect [Pair(sequence, commitment_bytes)] = inserted_commitments
      let commitment_key = packet_keys.packet_commitment_path(port_id, channel_id, sequence)
      let new_value = cbor.serialise(commitment_bytes)

      ibc_state_commitment.apply_update(
        root4,
        commitment_key,
        "",
        new_value,
        packet_commitment_siblings,
      )
    } else if removed_commitments != [] {
      // Exactly one deletion is expected in a single packet operation.
      expect [Pair(sequence, commitment_bytes)] = removed_commitments
      let commitment_key = packet_keys.packet_commitment_path(port_id, channel_id, sequence)
      let old_value = cbor.serialise(commitment_bytes)

      ibc_state_commitment.apply_update(
        root4,
        commitment_key,
        old_value,
        "",
        packet_commitment_siblings,
      )
    } else {
      root4
    }

  // 6) Packet receipt insertion (RecvPacket on unordered channels).
  let input_receipts = channel_input_datum.state.packet_receipt
  let output_receipts = channel_output_datum.state.packet_receipt

  let inserted_receipts =
    list.filter(output_receipts, fn(pair) { !pairs.has_key(input_receipts, pair.1st) })

  let removed_receipts =
    list.filter(input_receipts, fn(pair) { !pairs.has_key(output_receipts, pair.1st) })

  let root6 =
    if inserted_receipts != [] {
      // Receipts should only ever be inserted.
      expect removed_receipts == []
      expect [Pair(sequence, receipt_bytes)] = inserted_receipts
      let receipt_key = packet_keys.packet_receipt_path(port_id, channel_id, sequence)
      let new_value = cbor.serialise(receipt_bytes)

      ibc_state_commitment.apply_update(
        root5,
        receipt_key,
        "",
        new_value,
        packet_receipt_siblings,
      )
    } else {
      // If no insertion occurred, we also require no deletion occurred.
      expect removed_receipts == []
      root5
    }

  // 7) Packet acknowledgement insertion (RecvPacket writes the acknowledgement).
  let input_acks = channel_input_datum.state.packet_acknowledgement
  let output_acks = channel_output_datum.state.packet_acknowledgement

  let inserted_acks =
    list.filter(output_acks, fn(pair) { !pairs.has_key(input_acks, pair.1st) })

  let removed_acks =
    list.filter(input_acks, fn(pair) { !pairs.has_key(output_acks, pair.1st) })

  let root7 =
    if inserted_acks != [] {
      // Acknowledgements should only ever be inserted.
      expect removed_acks == []
      expect [Pair(sequence, ack_bytes)] = inserted_acks
      let ack_key = packet_keys.packet_acknowledgement_path(port_id, channel_id, sequence)
      let new_value = cbor.serialise(ack_bytes)

      ibc_state_commitment.apply_update(
        root6,
        ack_key,
        "",
        new_value,
        packet_acknowledgement_siblings,
      )
    } else {
      // If no insertion occurred, we also require no deletion occurred.
      expect removed_acks == []
      root6
    }

  root7 == new_datum.state.ibc_state_root
}

/// Main validator for HostState STT
/// 
/// Enforces:
/// 1. Exactly one input with NFT (the old state)
/// 2. Exactly one output with NFT (the new state)
/// 3. NFT is preserved (not burned or duplicated)
/// 4. Version increments by 1
/// 5. State transition is valid for the operation
	validator host_state_stt(
	  nft_policy: PolicyId,
	  spend_client_script_hash: Hash<Blake2b_224, Script>,
	  spend_connection_script_hash: Hash<Blake2b_224, Script>,
	  spend_channel_script_hash: Hash<Blake2b_224, Script>,
	) {
  spend(
    datum_opt: Option<HostStateDatum>,
    redeemer: HostStateRedeemer,
    _spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    // 1. Extract transaction fields
    let Transaction { inputs, outputs, .. } = transaction
    
    // 2. Find input HostState UTXO
    expect Some(host_input) = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    
    // 3. Find output HostState UTXO
    expect Some(host_output) = find_host_state_output(outputs, nft_policy)
    let new_datum = decode_host_state_datum(host_output)

    // The HostState NFT must remain locked at the HostState script address.
    //
    // In practice, this means the output that carries the NFT must stay at the
    // same address as the spent HostState UTxO.
    expect host_output.address == host_input.output.address
    
    // 4. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy
    expect new_datum.nft_policy == nft_policy
    
    // 5. Verify exactly one output with NFT (no duplication)
    let nft_output_count =
      list.count(
        outputs,
        fn(output) {
          let quantity =
            quantity_of(output.value, nft_policy, host_state_token_name)
          quantity == 1
        },
      )
    expect nft_output_count == 1
    
    // 6. Validate state transition based on operation
    when redeemer is {
      CreateClient { client_state_siblings, consensus_state_siblings } ->
        and {
          validate_create_client(old_datum, new_datum),
          validate_create_client_root(
            old_datum,
            new_datum,
            outputs,
            spend_client_script_hash,
            client_state_siblings,
            consensus_state_siblings,
          ),
        }
      
      CreateConnection { connection_siblings } ->
        and {
          validate_create_connection(old_datum, new_datum),
          validate_create_connection_root(
            old_datum,
            new_datum,
            outputs,
            spend_connection_script_hash,
            connection_siblings,
          ),
        }
      
	      CreateChannel {
	        channel_siblings,
	        next_sequence_send_siblings,
	        next_sequence_recv_siblings,
	        next_sequence_ack_siblings,
	      } ->
	        and {
	          validate_create_channel(old_datum, new_datum),
	          validate_create_channel_root(
	            old_datum,
	            new_datum,
	            outputs,
	            spend_channel_script_hash,
	            channel_siblings,
	            next_sequence_send_siblings,
	            next_sequence_recv_siblings,
	            next_sequence_ack_siblings,
	          ),
	        }
	      
	      BindPort { port, port_siblings } ->
	        and {
	          validate_bind_port(old_datum, new_datum, port),
	          validate_bind_port_root(old_datum, new_datum, port, port_siblings),
	        }
	      
	      UpdateClient {
	        client_state_siblings,
	        consensus_state_siblings,
	        removed_consensus_state_siblings,
      } ->
        and {
          // Client updates should not change HostState sequencing, only the root.
          validate_update_only_root(old_datum, new_datum),
          validate_update_client_root(
            old_datum,
            new_datum,
            inputs,
            outputs,
            spend_client_script_hash,
            client_state_siblings,
            consensus_state_siblings,
            removed_consensus_state_siblings,
          ),
        }
      
      UpdateConnection { connection_siblings } ->
        and {
          validate_update_only_root(old_datum, new_datum),
          validate_update_connection_root(
	            old_datum,
	            new_datum,
	            inputs,
	            outputs,
	            spend_connection_script_hash,
	            connection_siblings,
	          ),
	        }
	      
	      UpdateChannel { channel_siblings } ->
	        and {
	          // Channel updates should not change HostState sequencing, only the root.
	          validate_update_only_root(old_datum, new_datum),
	          validate_update_channel_root(
	            old_datum,
	            new_datum,
	            inputs,
	            outputs,
            spend_channel_script_hash,
            channel_siblings,
          ),
        }
      
      HandlePacket {
        channel_siblings,
        next_sequence_send_siblings,
        next_sequence_recv_siblings,
        next_sequence_ack_siblings,
        packet_commitment_siblings,
        packet_receipt_siblings,
        packet_acknowledgement_siblings,
      } ->
        and {
          // Packet operations should not change HostState sequencing, only the root.
          validate_update_only_root(old_datum, new_datum),
          validate_handle_packet_root(
            old_datum,
            new_datum,
            inputs,
            outputs,
            spend_channel_script_hash,
            channel_siblings,
            next_sequence_send_siblings,
            next_sequence_recv_siblings,
            next_sequence_ack_siblings,
            packet_commitment_siblings,
            packet_receipt_siblings,
            packet_acknowledgement_siblings,
          ),
        }
    }
  }
  
  else(_) {
    fail @"HostState STT can only be spent"
  }
}
