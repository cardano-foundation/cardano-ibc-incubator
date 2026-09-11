use aiken/cbor
// HostState is the single coordinator UTxO for IBC object creation and root updates.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/primitive/bytearray
use cardano/address
use cardano/assets.{AssetName, PolicyId, Value, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/keys as client_id_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/keys as conn_id_keys
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, PrunePacketHistory as PruneChannelPacketHistory, RecvPacket,
  SendPacket, SpendChannelRedeemer, TimeoutOnClose, TimeoutPacket,
}
use ibc/core/ics_004/types/keys as chan_id_keys
use ibc/core/ics_004/types/order.{Ordered}
use ibc/core/ics_004/types/packet as packet_mod
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ModuleRegistration, host_state_token_name,
  validate_bind_port, validate_create_channel, validate_create_client,
  validate_create_connection, validate_enter_shutdown,
  validate_finalize_shutdown, validate_heartbeat, validate_update_only_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, CreateChannel, CreateClient, CreateConnection, EnterShutdown,
  FinalizeShutdown, HandlePacket, Heartbeat, HostStateRedeemer, UpdateChannel,
  UpdateClient, UpdateConnection,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

/// Find the HostState UTXO input being spent
/// 
/// Returns the input that contains the IBC Host State NFT
fn find_host_state_input(inputs: List<Input>, nft_policy: PolicyId) -> Input {
  list.expect_find(
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

fn state_thread_name(
  nft_policy: PolicyId,
  prefix: ByteArray,
  sequence: ByteArray,
) -> AssetName {
  auth.generate_token_name(
    AuthToken { policy_id: nft_policy, name: host_state_token_name },
    prefix,
    sequence,
  )
}

/// The token named by an object datum is a claim, not authentication. Pin its
/// policy and full name before deriving an IBC key, and require the genuine
/// object validator to execute on the input that supplies the old state.
fn authenticate_state_thread(
  inputs: List<Input>,
  output: Output,
  token: AuthToken,
  policy_id: PolicyId,
  nft_policy: PolicyId,
  prefix: ByteArray,
) -> Input {
  expect token.policy_id == policy_id
  expect
    token.name == state_thread_name(
      nft_policy,
      prefix,
      auth.extract_token_sequence(token.name),
    )
  expect auth.contain_auth_token(output, token)
  let input =
    list.expect_find(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, token) },
    )
  // The output was selected using the pinned spending script.
  expect
    input.output.address.payment_credential == output.address.payment_credential
  input
}

/// Creation must execute the genuine mint policy, which validates the initial
/// object state and locks its token at the expected spending validator.
fn authenticate_created_state_thread(
  output: Output,
  token: AuthToken,
  mint: Value,
  nft_policy: PolicyId,
  policy_id: PolicyId,
  prefix: ByteArray,
  sequence: Int,
) -> Bool {
  let expected_name =
    state_thread_name(nft_policy, prefix, string_utils.int_to_string(sequence))
  and {
    token.policy_id == policy_id,
    token.name == expected_name,
    auth.contain_auth_token(output, token),
    validator_utils.require_exact_marker_mint(mint, policy_id, expected_name, 1),
  }
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

fn decode_client_datum(output: Output) -> ClientDatum {
  expect datum: ClientDatum = validator_utils.get_inline_datum(output)
  datum
}

fn decode_connection_datum(output: Output) -> ConnectionDatum {
  expect datum: ConnectionDatum = validator_utils.get_inline_datum(output)
  datum
}

fn decode_channel_datum(output: Output) -> ChannelDatum {
  expect datum: ChannelDatum = validator_utils.get_inline_datum(output)
  datum
}

fn find_state_output(
  outputs: List<Output>,
  script_hash: Hash<Blake2b_224, Script>,
) -> Output {
  expect [output] =
    list.filter(
      outputs,
      fn(output) {
        output.address.payment_credential == address.Script(script_hash)
      },
    )
  output
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
  mint: Value,
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  client_policy_id: PolicyId,
  client_state_siblings: List<ByteArray>,
  consensus_state_siblings: List<ByteArray>,
) -> Bool {
  // Find the newly created client output.
  //
  // `mint_client_stt` enforces there is exactly one client output for CreateClient,
  // so we require exactly one here too.
  let client_output = find_state_output(outputs, spend_client_script_hash)

  // Decode the client datum so we can derive the exact state bytes that must be
  // committed into the Merkle root.
  let client_datum = decode_client_datum(client_output)

  expect
    authenticate_created_state_thread(
      client_output,
      client_datum.token,
      mint,
      old_datum.nft_policy,
      client_policy_id,
      client_id_keys.client_prefix,
      old_datum.state.next_client_sequence,
    )

  // Derive the client identifier from the HostState sequence.
  //
  // This matches the off-chain convention: `07-tendermint-{sequence}`.
  let client_id =
    "07-tendermint-"
      |> bytearray.concat(
          string_utils.int_to_string(old_datum.state.next_client_sequence),
        )

  // Commitment keys (IBC paths).
  let client_state_key = client_keys.full_client_state_path(client_id)

  // The initial consensus state is stored at the client's latest height.
  let latest_height = client_datum.state.client_state.latest_height
  let consensus_height =
    string_utils.int_to_string(latest_height.revision_height)
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
  client_policy_id: PolicyId,
  client_state_siblings: List<ByteArray>,
  consensus_state_siblings: List<ByteArray>,
  removed_consensus_state_siblings: List<List<ByteArray>>,
) -> Bool {
  // Find the updated client output.
  //
  // `spend_client` enforces there is exactly one client output in this transaction,
  // so we require exactly one here too.
  let client_output = find_state_output(outputs, spend_client_script_hash)

  let client_output_datum = decode_client_datum(client_output)

  let client_input =
    authenticate_state_thread(
      inputs,
      client_output,
      client_output_datum.token,
      client_policy_id,
      old_datum.nft_policy,
      client_id_keys.client_prefix,
    )

  let client_input_datum = decode_client_datum(client_input.output)
  expect client_input_datum.token == client_output_datum.token

  let client_id = client_id_from_token_name(client_output_datum.token.name)

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
fn validate_create_connection_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  outputs: List<Output>,
  mint: Value,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  connection_policy_id: PolicyId,
  connection_siblings: List<ByteArray>,
) -> Bool {
  // Find the newly created connection output.
  //
  // `mint_connection_stt` enforces there is exactly one connection output for CreateConnection,
  // so we require exactly one here too.
  let connection_output =
    find_state_output(outputs, spend_connection_script_hash)

  // Decode the connection datum so we can derive the exact state bytes that must be
  // committed into the Merkle root.
  let connection_datum = decode_connection_datum(connection_output)

  expect
    authenticate_created_state_thread(
      connection_output,
      connection_datum.token,
      mint,
      old_datum.nft_policy,
      connection_policy_id,
      conn_id_keys.connection_prefix,
      old_datum.state.next_connection_sequence,
    )

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
  mint: Value,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_policy_id: PolicyId,
  channel_siblings: List<ByteArray>,
  next_sequence_send_siblings: List<ByteArray>,
  next_sequence_recv_siblings: List<ByteArray>,
  next_sequence_ack_siblings: List<ByteArray>,
) -> Bool {
  // Find the newly created channel output.
  //
  // `mint_channel_stt` enforces there is exactly one channel output for CreateChannel,
  // so we require exactly one here too.
  let channel_output = find_state_output(outputs, spend_channel_script_hash)

  // Decode the channel datum so we can derive the exact state bytes that must be
  // committed into the Merkle root.
  let channel_datum = decode_channel_datum(channel_output)

  expect
    authenticate_created_state_thread(
      channel_output,
      channel_datum.token,
      mint,
      old_datum.nft_policy,
      channel_policy_id,
      chan_id_keys.channel_prefix,
      old_datum.state.next_channel_sequence,
    )

  // Derive the channel identifier from the HostState sequence.
  //
  // This matches the off-chain convention: `channel-{sequence}`.
  let channel_id =
    string_utils.int_to_string(old_datum.state.next_channel_sequence)
      |> chan_id_keys.format_channel_identifier()

  // Commitment keys (IBC paths).
  let port_id = channel_datum.port_id
  let channel_key = host_channel_keys.channel_path(port_id, channel_id)
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path(port_id, channel_id)
  let next_sequence_recv_key =
    packet_keys.next_sequence_recv_path(port_id, channel_id)
  let next_sequence_ack_key =
    packet_keys.next_sequence_ack_path(port_id, channel_id)

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
  connection_policy_id: PolicyId,
  connection_siblings: List<ByteArray>,
) -> Bool {
  // Find the updated connection output.
  //
  // `spend_connection` enforces there is exactly one connection output in this transaction,
  // so we require exactly one here too.
  let connection_output =
    find_state_output(outputs, spend_connection_script_hash)

  // Decode the output datum so we can:
  // - derive the connection id from its token name
  // - compute the exact CBOR bytes that are committed into the Merkle root
  let connection_output_datum = decode_connection_datum(connection_output)

  let connection_input =
    authenticate_state_thread(
      inputs,
      connection_output,
      connection_output_datum.token,
      connection_policy_id,
      old_datum.nft_policy,
      conn_id_keys.connection_prefix,
    )

  let connection_input_datum = decode_connection_datum(connection_input.output)
  expect connection_input_datum.token == connection_output_datum.token

  let connection_id =
    connection_id_from_token_name(connection_output_datum.token.name)
  let connection_key = host_connection_keys.connection_path(connection_id)

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
  channel_policy_id: PolicyId,
  channel_siblings: List<ByteArray>,
) -> Bool {
  // Find the updated channel output.
  //
  // `spend_channel` enforces there is exactly one channel output in this transaction,
  // so we require exactly one here too.
  let channel_output = find_state_output(outputs, spend_channel_script_hash)

  // Decode the output datum so we can:
  // - derive the channel id from its token name
  // - read the port id (which is part of the IBC path)
  // - compute the exact CBOR bytes that are committed into the Merkle root
  let channel_output_datum = decode_channel_datum(channel_output)

  let channel_input =
    authenticate_state_thread(
      inputs,
      channel_output,
      channel_output_datum.token,
      channel_policy_id,
      old_datum.nft_policy,
      chan_id_keys.channel_prefix,
    )

  let channel_input_datum = decode_channel_datum(channel_input.output)
  expect channel_input_datum.token == channel_output_datum.token

  let channel_id = channel_id_from_token_name(channel_output_datum.token.name)
  let port_id = channel_output_datum.port_id
  let channel_key = host_channel_keys.channel_path(port_id, channel_id)

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

/// Load a required packet-map entry, failing closed when it is absent.
fn required_packet_entry(
  entries: Pairs<Int, ByteArray>,
  sequence: Int,
) -> ByteArray {
  pairs.expect_get_first(entries, sequence)
}

fn apply_packet_commitment_deletion(
  root: ByteArray,
  channel_datum: ChannelDatum,
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
  siblings: List<ByteArray>,
) -> ByteArray {
  let commitment =
    required_packet_entry(channel_datum.state.packet_commitment, sequence)
  ibc_state_commitment.apply_update(
    root,
    packet_keys.packet_commitment_path(port_id, channel_id, sequence),
    cbor.serialise(commitment),
    "",
    siblings,
  )
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
/// The channel redeemer identifies the exact keys changed by each canonical
/// transition. Applying only those operation-specific updates is both stricter
/// and smaller than rediscovering the same changes by diffing every packet map.
fn validate_handle_packet_root(
  old_datum: HostStateDatum,
  new_datum: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_policy_id: PolicyId,
  channel_siblings: List<ByteArray>,
  next_sequence_send_siblings: List<ByteArray>,
  next_sequence_recv_siblings: List<ByteArray>,
  next_sequence_ack_siblings: List<ByteArray>,
  packet_commitment_siblings: List<ByteArray>,
  packet_receipt_siblings: List<ByteArray>,
  packet_acknowledgement_siblings: List<ByteArray>,
) -> Bool {
  // Find the updated channel output.
  let channel_output = find_state_output(outputs, spend_channel_script_hash)

  let channel_output_datum = decode_channel_datum(channel_output)

  let channel_input =
    authenticate_state_thread(
      inputs,
      channel_output,
      channel_output_datum.token,
      channel_policy_id,
      old_datum.nft_policy,
      chan_id_keys.channel_prefix,
    )

  let channel_input_datum = decode_channel_datum(channel_input.output)
  expect channel_input_datum.token == channel_output_datum.token

  let channel_id = channel_id_from_token_name(channel_output_datum.token.name)
  let port_id = channel_output_datum.port_id

  expect Some(channel_redeemer_data) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect channel_redeemer: SpendChannelRedeemer = channel_redeemer_data

  let old_root = old_datum.state.ibc_state_root
  let is_ordered = channel_input_datum.state.channel.ordering == Ordered
  let timeout_root =
    fn(packet, update_channel) {
      expect
        channel_datum_mod.validate_timeout_packet(
          channel_input_datum,
          channel_output_datum,
          packet,
        )
      let channel_root =
        if update_channel {
          ibc_state_commitment.apply_update(
            old_root,
            host_channel_keys.channel_path(port_id, channel_id),
            cbor.serialise(channel_input_datum.state.channel),
            cbor.serialise(channel_output_datum.state.channel),
            channel_siblings,
          )
        } else {
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
        let acknowledgement =
          required_packet_entry(
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
      TimeoutPacket { packet, .. } -> timeout_root(packet, is_ordered)
      TimeoutOnClose { packet, .. } ->
        timeout_root(
          packet,
          channel_input_datum.state.channel != channel_output_datum.state.channel,
        )
      PruneChannelPacketHistory { sequence, .. } -> {
        // The prune marker validates the complete successor datum and the
        // authenticated absence proof. The HostState side binds that typed
        // operation to the same sequence and commits the ordering-specific
        // deletion: acknowledgement only for ordered channels, or the receipt
        // and acknowledgement pair for unordered channels.
        let acknowledgement =
          required_packet_entry(
            channel_input_datum.state.packet_acknowledgement,
            sequence,
          )
        let receipt_root =
          if is_ordered {
            // Ordered replay protection is the monotonic next_sequence_recv
            // counter, so receipt state remains unchanged.
            old_root
          } else {
            let receipt =
              required_packet_entry(
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
  client_policy_id: PolicyId,
  connection_policy_id: PolicyId,
  channel_policy_id: PolicyId,
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
    let host_input = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    // 3. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy

    // 4. Validate state transition based on operation.
    when redeemer is {
      FinalizeShutdown -> and {
          list.has(extra_signatories, old_datum.deployer),
          validate_finalize_shutdown(
            old_datum,
            validator_utils.get_tx_valid_from(validity_range),
          ),
          validator_utils.require_exact_marker_mint(
            mint,
            nft_policy,
            host_state_token_name,
            -1,
          ),
          !list.any(
            outputs,
            fn(output) {
              quantity_of(output.value, nft_policy, host_state_token_name) != 0
            },
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

        // Each transition below preserves the authenticated input's NFT policy.
        when redeemer is {
          CreateClient { client_state_siblings, consensus_state_siblings } ->
            and {
              validate_create_client(old_datum, new_datum),
              validate_create_client_root(
                old_datum,
                new_datum,
                outputs,
                mint,
                spend_client_script_hash,
                client_policy_id,
                client_state_siblings,
                consensus_state_siblings,
              ),
            }
          CreateConnection { connection_siblings } -> and {
              validate_create_connection(old_datum, new_datum),
              validate_create_connection_root(
                old_datum,
                new_datum,
                outputs,
                mint,
                spend_connection_script_hash,
                connection_policy_id,
                connection_siblings,
              ),
            }
          CreateChannel {
            channel_siblings,
            next_sequence_send_siblings,
            next_sequence_recv_siblings,
            next_sequence_ack_siblings,
          } -> and {
              validate_create_channel(old_datum, new_datum),
              validate_create_channel_root(
                old_datum,
                new_datum,
                outputs,
                mint,
                spend_channel_script_hash,
                channel_policy_id,
                channel_siblings,
                next_sequence_send_siblings,
                next_sequence_recv_siblings,
                next_sequence_ack_siblings,
              ),
            }
          BindPort { port_id, registration, port_siblings } -> and {
              // A permanent global registration is an administrative action.
              // Requiring the deployment authority prevents port squatting and
              // makes the protocol-wide bound useful rather than attacker-fillable.
              list.has(extra_signatories, old_datum.deployer),
              validate_bind_port(old_datum, new_datum, port_id, registration),
              validate_bind_port_root(
                old_datum,
                new_datum,
                port_id,
                registration,
                outputs,
                port_siblings,
              ),
            }
          UpdateClient {
            client_state_siblings,
            consensus_state_siblings,
            removed_consensus_state_siblings,
          } -> and {
              // Client updates should not change HostState sequencing, only the root.
              validate_update_only_root(old_datum, new_datum),
              validate_update_client_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                spend_client_script_hash,
                client_policy_id,
                client_state_siblings,
                consensus_state_siblings,
                removed_consensus_state_siblings,
              ),
            }
          UpdateConnection { connection_siblings } -> and {
              validate_update_only_root(old_datum, new_datum),
              validate_update_connection_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                spend_connection_script_hash,
                connection_policy_id,
                connection_siblings,
              ),
            }
          UpdateChannel { channel_siblings } -> and {
              // Channel updates should not change HostState sequencing, only the root.
              validate_update_only_root(old_datum, new_datum),
              validate_update_channel_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                spend_channel_script_hash,
                channel_policy_id,
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
          } -> and {
              // Packet operations should not change HostState sequencing, only the root.
              validate_update_only_root(old_datum, new_datum),
              validate_handle_packet_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                redeemers,
                spend_channel_script_hash,
                channel_policy_id,
                channel_siblings,
                next_sequence_send_siblings,
                next_sequence_recv_siblings,
                next_sequence_ack_siblings,
                packet_commitment_siblings,
                packet_receipt_siblings,
                packet_acknowledgement_siblings,
              ),
            }
          EnterShutdown { grace_period_end } -> and {
              list.has(extra_signatories, old_datum.deployer),
              validate_enter_shutdown(
                old_datum,
                new_datum,
                grace_period_end,
                validator_utils.get_tx_valid_to(validity_range),
              ),
            }
          Heartbeat -> and {
              list.has(extra_signatories, old_datum.deployer),
              validate_heartbeat(old_datum, new_datum),
            }
          FinalizeShutdown -> fail
        }
      }
    }
  }

  else(_) {
    fail @"HostState STT can only be spent"
  }
}
