use aiken/cbor
// HostState is the single coordinator UTxO for IBC object creation and root updates.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/primitive/bytearray
use cardano/address as address
use cardano/assets.{AssetName, PolicyId, Value, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/keys as conn_id_keys
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, PrunePacketHistory as PruneChannelPacketHistory, RecvPacket,
  SendPacket, SpendChannelRedeemer, TimeoutPacket,
}
use ibc/core/ics_004/types/keys as chan_id_keys
use ibc/core/ics_004/types/order.{Ordered}
use ibc/core/ics_004/types/packet as packet_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer, Operator}
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ModuleRegistration, host_state_token_name,
  is_host_state_reclaimable, validate_bind_port, validate_create_channel,
  validate_create_client, validate_create_connection, validate_enter_shutdown,
  validate_heartbeat, validate_reclaim_channel, validate_reclaim_client,
  validate_reclaim_connection, validate_reclaim_module, validate_seal_shutdown,
  validate_update_module_state, validate_update_only_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BeginChannelAbandonment, BeginConnectionRetirement, BindPort, CreateChannel,
  CreateClient, CreateConnection, EnterShutdown, FinalizeShutdown, HandlePacket,
  Heartbeat, HostStateRedeemer, PruneTerminalClient, ReclaimChannel,
  ReclaimClient, ReclaimConnection, ReclaimHostState, ReclaimModule,
  SealShutdown, UpdateChannel, UpdateClient, UpdateConnection, UpdateModuleState,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  lifecycle_marker_token_name,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

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
      assets.has_nft(input.output.value, nft_policy, host_state_token_name)
    },
  )
}

/// Find the HostState UTXO output being created
/// 
/// Returns the output that contains the IBC Host State NFT
fn find_host_state_output(outputs: List<Output>, nft_policy: PolicyId) -> Output {
  // Selecting the singleton directly preserves the uniqueness invariant while
  // avoiding the previous follow-up count over every transaction output.
  expect [host_output] =
    list.filter(
      outputs,
      fn(output) {
        assets.has_nft(output.value, nft_policy, host_state_token_name)
      },
    )
  host_output
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
      assets.has_nft(input.output.value, token.policy_id, token.name)
    },
  )
}

fn inputs_at_script(
  inputs: List<Input>,
  script_hash: Hash<Blake2b_224, Script>,
) -> List<Input> {
  list.filter(
    inputs,
    fn(input) {
      when input.output.address.payment_credential is {
        address.Script(actual_hash) -> actual_hash == script_hash
        _ -> False
      }
    },
  )
}

fn module_input_for_registration(
  inputs: List<Input>,
  registration: ModuleRegistration,
) -> Input {
  expect [module_input] =
    list.filter(
      inputs,
      fn(input) {
        and {
          input.output.address.payment_credential == address.Script(
            registration.module_script_hash,
          ),
          auth.contains_only_auth_tokens(
            input.output,
            [registration.port_token, registration.module_token],
          ),
        }
      },
    )
  module_input
}

fn validate_module_operator(
  host_datum: HostStateDatum,
  port_id: ByteArray,
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> Bool {
  expect Some(registration) =
    pairs.get_first(host_datum.state.bound_port, port_id)
  let module_input = module_input_for_registration(inputs, registration)

  when module_input_redeemer(module_input, redeemers) is {
    Operator(_) -> True
    _ -> False
  }
}

fn module_input_redeemer(
  module_input: Input,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> IBCModuleRedeemer {
  expect Some(module_redeemer_data) =
    pairs.get_first(redeemers, Spend(module_input.output_reference))
  expect module_redeemer: IBCModuleRedeemer = module_redeemer_data
  module_redeemer
}

fn client_id_from_token_name(token_name: AssetName) -> ByteArray {
  let sequence = auth.extract_token_sequence(token_name)
  "07-tendermint-" |> bytearray.concat(sequence)
}

/// Derive a `connection-{N}` identifier from a connection token name.
///
/// Connection auth tokens are generated with `auth.generate_token_name(...)`.
/// That scheme is hash-based and appends the decimal sequence number as a postfix.
///
/// The on-chain code needs the `connection-{N}` identifier form for the ICS-24 store key.
fn connection_id_from_token_name(token_name: AssetName) -> ByteArray {
  let sequence = auth.extract_token_sequence(token_name)
  sequence |> conn_id_keys.format_connection_identifier()
}

/// Derive a `channel-{N}` identifier from a channel token name.
///
/// Channel auth tokens are generated with `auth.generate_token_name(...)`.
/// That scheme is hash-based and appends the decimal sequence number as a postfix.
///
/// The on-chain code needs the `channel-{N}` identifier form for the ICS-24 store key.
fn channel_id_from_token_name(token_name: AssetName) -> ByteArray {
  let sequence = auth.extract_token_sequence(token_name)
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
      let consensus_key =
        client_keys.full_client_consensus_state_path(client_id, height_str)

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

      apply_removed_consensus_state_updates(
        next_root,
        client_id,
        rest_pairs,
        rest_siblings,
      )
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
  client_minting_policy_id: PolicyId,
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
  expect client_output_datum.token.policy_id == client_minting_policy_id

  // Identify which client is being updated.
  let client_id = client_id_from_token_name(client_output_datum.token.name)

  // Find the input client UTxO by looking for the same auth token.
  expect Some(client_input) =
    find_input_with_auth_token(inputs, client_output_datum.token)

  expect client_input_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)

  // 1) Apply the clientState update.
  let client_state_key = client_keys.full_client_state_path(client_id)

  let old_client_state_value =
    cbor.serialise(client_input_datum.state.client_state)
  let new_client_state_value =
    cbor.serialise(client_output_datum.state.client_state)

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
        let consensus_key =
          client_keys.full_client_consensus_state_path(client_id, height_str)
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
fn validate_bind_port_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  port_id: ByteArray,
  registration: ModuleRegistration,
  outputs: List<Output>,
  port_siblings: List<ByteArray>,
) -> Bool {
  // Commitment key (IBC path): `ports/{portId}`.
  //
  let port_key =
    key_port_prefix
      |> bytearray.concat("/")
      |> bytearray.concat(port_id)

  // Commitment value.
  //
  // Commit the immutable application authority, not merely an "is bound"
  // marker. This makes the port-to-module association part of the IBC root.
  let port_value = cbor.serialise(registration)

  // The initial root must be created at the registered script credential with
  // precisely the two registered capability NFTs. Its datum is application
  // state owned and interpreted by the registered module, not IBC core.
  expect [module_output] =
    transaction.find_script_outputs(outputs, registration.module_script_hash)

  let root_after_bind =
    ibc_state_commitment.apply_update(
      old_datum.state.ibc_state_root,
      port_key,
      "",
      port_value,
      port_siblings,
    )

  and {
    root_after_bind == new_datum.state.ibc_state_root,
    auth.contains_only_auth_tokens(
      module_output,
      [registration.port_token, registration.module_token],
    ),
  }
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
  connection_minting_policy_id: PolicyId,
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
  expect connection_output_datum.token.policy_id == connection_minting_policy_id

  let connection_id =
    connection_id_from_token_name(connection_output_datum.token.name)
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
  channel_minting_policy_id: PolicyId,
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
  expect channel_output_datum.token.policy_id == channel_minting_policy_id

  let channel_id = channel_id_from_token_name(channel_output_datum.token.name)
  let port_id = channel_output_datum.port_id
  let channel_key = host_channel_keys.channel_path(port_id, channel_id)

  // Find the input channel UTxO by looking for the same auth token.
  expect Some(channel_input) =
    find_input_with_auth_token(inputs, channel_output_datum.token)

  expect channel_input_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)

  // UpdateChannel only commits the channel end key; packet and sequence fields
  // must be handled by HandlePacket.
  expect
    ChannelDatum {
      ..channel_input_datum,
      state: ChannelDatumState {
        ..channel_input_datum.state,
        channel: channel_output_datum.state.channel,
      },
    } == channel_output_datum

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

fn apply_packet_commitment_deletion(
  root: ByteArray,
  channel_datum: ChannelDatum,
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
  siblings: List<ByteArray>,
) -> ByteArray {
  expect Some(commitment) =
    pairs.get_first(channel_datum.state.packet_commitment, sequence)
  ibc_state_commitment.apply_update(
    root,
    packet_keys.packet_commitment_path(port_id, channel_id, sequence),
    cbor.serialise(commitment),
    "",
    siblings,
  )
}

fn validate_handle_packet_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_minting_policy_id: PolicyId,
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
  expect channel_output_datum.token.policy_id == channel_minting_policy_id

  let channel_id = channel_id_from_token_name(channel_output_datum.token.name)
  let port_id = channel_output_datum.port_id

  // Find the input channel UTxO by looking for the same auth token.
  expect Some(channel_input) =
    find_input_with_auth_token(inputs, channel_output_datum.token)

  expect channel_input_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)

  expect Some(channel_redeemer_data) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect channel_redeemer: SpendChannelRedeemer = channel_redeemer_data

  let old_root = old_datum.state.ibc_state_root
  let is_ordered = channel_input_datum.state.channel.ordering == Ordered
  let expected_root =
    when channel_redeemer is {
      SendPacket { packet } -> {
        let commitment = packet_mod.commit_packet(packet)
        expect
          channel_datum_mod.validate_send_packet(
            channel_input_datum,
            channel_output_datum,
            packet,
            commitment,
          )
        let sequence_root =
          ibc_state_commitment.apply_update(
            old_root,
            packet_keys.next_sequence_send_path(port_id, channel_id),
            cbor.serialise(channel_input_datum.state.next_sequence_send),
            cbor.serialise(channel_output_datum.state.next_sequence_send),
            next_sequence_send_siblings,
          )
        ibc_state_commitment.apply_update(
          sequence_root,
          packet_keys.packet_commitment_path(
            port_id,
            channel_id,
            packet.sequence,
          ),
          "",
          cbor.serialise(commitment),
          packet_commitment_siblings,
        )
      }
      RecvPacket { packet, proof_height, .. } -> {
        expect Some(acknowledgement) =
          pairs.get_first(
            channel_output_datum.state.packet_acknowledgement,
            packet.sequence,
          )
        expect
          channel_datum_mod.validate_recv_packet(
            channel_input_datum,
            channel_output_datum,
            packet,
            acknowledgement,
            proof_height,
          )
        let sequence_root =
          if is_ordered {
            ibc_state_commitment.apply_update(
              old_root,
              packet_keys.next_sequence_recv_path(port_id, channel_id),
              cbor.serialise(channel_input_datum.state.next_sequence_recv),
              cbor.serialise(channel_output_datum.state.next_sequence_recv),
              next_sequence_recv_siblings,
            )
          } else {
            old_root
          }
        let receipt_root =
          if is_ordered {
            sequence_root
          } else {
            ibc_state_commitment.apply_update(
              sequence_root,
              packet_keys.packet_receipt_path(
                port_id,
                channel_id,
                packet.sequence,
              ),
              "",
              cbor.serialise(""),
              packet_receipt_siblings,
            )
          }
        ibc_state_commitment.apply_update(
          receipt_root,
          packet_keys.packet_acknowledgement_path(
            port_id,
            channel_id,
            packet.sequence,
          ),
          "",
          cbor.serialise(acknowledgement),
          packet_acknowledgement_siblings,
        )
      }
      AcknowledgePacket { packet, .. } -> {
        expect
          channel_datum_mod.validate_acknowledge_packet(
            channel_input_datum,
            channel_output_datum,
            packet,
          )
        let sequence_root =
          if is_ordered {
            ibc_state_commitment.apply_update(
              old_root,
              packet_keys.next_sequence_ack_path(port_id, channel_id),
              cbor.serialise(channel_input_datum.state.next_sequence_ack),
              cbor.serialise(channel_output_datum.state.next_sequence_ack),
              next_sequence_ack_siblings,
            )
          } else {
            old_root
          }
        apply_packet_commitment_deletion(
          sequence_root,
          channel_input_datum,
          port_id,
          channel_id,
          packet.sequence,
          packet_commitment_siblings,
        )
      }
      TimeoutPacket { packet, .. } -> {
        expect
          channel_datum_mod.validate_timeout_packet(
            channel_input_datum,
            channel_output_datum,
            packet,
          )
        let channel_changed =
          channel_input_datum.state.channel != channel_output_datum.state.channel
        let channel_root =
          if channel_changed {
            expect is_ordered
            ibc_state_commitment.apply_update(
              old_root,
              host_channel_keys.channel_path(port_id, channel_id),
              cbor.serialise(channel_input_datum.state.channel),
              cbor.serialise(channel_output_datum.state.channel),
              channel_siblings,
            )
          } else {
            expect channel_siblings == []
            old_root
          }
        apply_packet_commitment_deletion(
          channel_root,
          channel_input_datum,
          port_id,
          channel_id,
          packet.sequence,
          packet_commitment_siblings,
        )
      }
      PruneChannelPacketHistory { sequence, .. } -> {
        // The prune marker validates the complete successor datum and the
        // authenticated absence proof. The HostState side binds that typed
        // operation to the same sequence and commits its paired deletions.
        expect Some(acknowledgement) =
          pairs.get_first(
            channel_input_datum.state.packet_acknowledgement,
            sequence,
          )
        let receipt_root =
          if is_ordered {
            expect packet_receipt_siblings == []
            old_root
          } else {
            expect Some(receipt) =
              pairs.get_first(
                channel_input_datum.state.packet_receipt,
                sequence,
              )
            ibc_state_commitment.apply_update(
              old_root,
              packet_keys.packet_receipt_path(port_id, channel_id, sequence),
              cbor.serialise(receipt),
              "",
              packet_receipt_siblings,
            )
          }
        ibc_state_commitment.apply_update(
          receipt_root,
          packet_keys.packet_acknowledgement_path(port_id, channel_id, sequence),
          cbor.serialise(acknowledgement),
          "",
          packet_acknowledgement_siblings,
        )
      }
      _ -> fail
    }

  expected_root == new_datum.state.ibc_state_root
}

fn preserves_lifecycle_marker(
  input: Output,
  output: Output,
  mint: Value,
  policy: PolicyId,
) -> Bool {
  quantity_of(output.value, policy, lifecycle_marker_token_name) == quantity_of(
    input.value,
    policy,
    lifecycle_marker_token_name,
  ) + quantity_of(mint, policy, lifecycle_marker_token_name)
}

fn mints_lifecycle_marker(mint: Value, policy: PolicyId) -> Bool {
  auth.mint_auth_token(
    mint,
    AuthToken { policy_id: policy, name: lifecycle_marker_token_name },
  )
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
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  lifecycle_creation_policy_id: PolicyId,
  lifecycle_reclamation_policy_id: PolicyId,
  lifecycle_operational_policy_id: PolicyId,
  lifecycle_packet_policy_id: PolicyId,
) {
  spend(
    _datum_opt: Option<HostStateDatum>,
    redeemer: HostStateRedeemer,
    _spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    // 1. Extract transaction fields
    let Transaction {
      inputs,
      outputs,
      mint,
      redeemers,
      extra_signatories,
      validity_range,
      ..
    } = transaction
    // 2. Find input HostState UTXO
    expect Some(host_input) = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    // 3. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy

    // 4. Validate state transition based on operation.
    when redeemer is {
      FinalizeShutdown -> False
      ReclaimHostState { reclaim_to } -> and {
          list.has(extra_signatories, old_datum.deployer),
          is_host_state_reclaimable(
            old_datum,
            validator_utils.get_tx_valid_from(validity_range),
          ),
          auth.burn_auth_token(
            mint,
            AuthToken { policy_id: nft_policy, name: host_state_token_name },
          ),
          !list.any(
            outputs,
            fn(output) {
              assets.has_nft(output.value, nft_policy, host_state_token_name)
            },
          ),
          validator_utils.pays_exact_ada_only_reclamation_bounty(
            host_input.output,
            outputs,
            reclaim_to,
          ),
        }
      _ -> {
        // Non-final transitions must re-create exactly one HostState UTxO.
        let host_output = find_host_state_output(outputs, nft_policy)
        let new_datum = decode_host_state_datum(host_output)

        // The HostState NFT must remain locked at the HostState script address.
        //
        // In practice, this means the output that carries the NFT must stay at the
        // same address as the spent HostState UTxO.
        expect host_output.address == host_input.output.address
        expect new_datum.nft_policy == nft_policy

        and {
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_creation_policy_id,
          ),
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_reclamation_policy_id,
          ),
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_operational_policy_id,
          ),
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_packet_policy_id,
          ),
          when redeemer is {
            CreateClient { .. } -> and {
                validate_create_client(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_creation_policy_id),
              }
            CreateConnection { .. } -> and {
                validate_create_connection(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_creation_policy_id),
              }
            CreateChannel { .. } -> and {
                validate_create_channel(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_creation_policy_id),
              }
            BindPort { port_id, registration, .. } -> and {
                // A permanent global registration is an administrative action.
                // Requiring the deployment authority prevents port squatting and
                // makes the protocol-wide bound useful rather than attacker-fillable.
                list.has(extra_signatories, old_datum.deployer),
                validate_bind_port(old_datum, new_datum, port_id, registration),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            UpdateClient { .. } -> and {
                // Client updates should not change HostState sequencing, only the root.
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            UpdateConnection { .. } -> and {
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            UpdateChannel { .. } -> and {
                // Channel updates should not change HostState sequencing, only the root.
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            HandlePacket { .. } -> and {
                // Packet operations should not change HostState sequencing, only the root.
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_packet_policy_id),
              }
            PruneTerminalClient { .. } -> and {
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            BeginConnectionRetirement -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_update_only_root(old_datum, new_datum),
                new_datum.state.ibc_state_root == old_datum.state.ibc_state_root,
                list.length(
                  inputs_at_script(inputs, spend_connection_script_hash),
                ) == 1,
                list.length(
                  transaction.find_script_outputs(
                    outputs,
                    spend_connection_script_hash,
                  ),
                ) == 1,
              }
            BeginChannelAbandonment -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_update_only_root(old_datum, new_datum),
                new_datum.state.ibc_state_root == old_datum.state.ibc_state_root,
                list.length(inputs_at_script(inputs, spend_channel_script_hash)) == 1,
                list.length(
                  transaction.find_script_outputs(
                    outputs,
                    spend_channel_script_hash,
                  ),
                ) == 1,
              }
            ReclaimChannel { .. } -> and {
                validate_reclaim_channel(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            ReclaimConnection { .. } -> and {
                validate_reclaim_connection(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            ReclaimClient { .. } -> and {
                validate_reclaim_client(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            EnterShutdown { grace_period_end } -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_enter_shutdown(old_datum, new_datum, grace_period_end),
              }
            SealShutdown -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_seal_shutdown(
                  old_datum,
                  new_datum,
                  validator_utils.get_tx_valid_from(validity_range),
                ),
              }
            ReclaimModule { port_id } -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_reclaim_module(old_datum, new_datum, port_id),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            UpdateModuleState { port_id } -> and {
                validate_update_module_state(old_datum, new_datum),
                validate_module_operator(old_datum, port_id, inputs, redeemers),
              }
            Heartbeat -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_heartbeat(old_datum, new_datum),
              }
            FinalizeShutdown | ReclaimHostState { .. } -> fail
          },
        }
      }
    }
  }

  else(_) {
    fail @"HostState STT can only be spent"
  }
}
