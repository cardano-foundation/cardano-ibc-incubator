use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{Input, Output, Spend, Transaction, ValidityRange}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_reclamation
use ibc/client/ics_007_tendermint_client/client_state
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys as client_id_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionDatum, validate_increment_channel_count,
}
use ibc/core/ics_003_connection_semantics/types/keys as connection_id_keys
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/types/keys as channel_id_keys
use ibc/core/ics_004/types/order
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateChannel, CreateClient, CreateConnection, HostStateRedeemer,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizeCreation, LifecycleCreationMarkerRedeemer,
  lifecycle_marker_token_name,
}
use ibc/core/ics_025_handler_interface/reclamation
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

fn host_thread(
  inputs: List<Input>,
  outputs: List<Output>,
  host_policy: PolicyId,
) -> (Input, Output, HostStateDatum, HostStateDatum) {
  let token = AuthToken { policy_id: host_policy, name: host_state_token_name }
  expect [host_input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, token) },
    )
  expect [host_output] =
    list.filter(outputs, fn(output) { auth.contain_auth_token(output, token) })
  expect host_output.address == host_input.output.address
  expect old: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  expect new: HostStateDatum = validator_utils.get_inline_datum(host_output)
  expect old.nft_policy == host_policy
  expect new.nft_policy == host_policy
  (host_input, host_output, old, new)
}

fn outputs_with_policy(outputs: List<Output>, policy: PolicyId) -> List<Output> {
  list.filter(
    outputs,
    fn(output) { !(output.value |> tokens(policy) |> dict.is_empty) },
  )
}

fn inputs_with_policy(inputs: List<Input>, policy: PolicyId) -> List<Input> {
  list.filter(
    inputs,
    fn(input) { !(input.output.value |> tokens(policy) |> dict.is_empty) },
  )
}

fn canonical_token(output: Output, policy: PolicyId) -> AuthToken {
  expect [Pair(name, 1)] = output.value |> tokens(policy) |> dict.to_pairs
  AuthToken { policy_id: policy, name }
}

fn expected_token(
  host_policy: PolicyId,
  policy: PolicyId,
  prefix: ByteArray,
  sequence: Int,
) -> AuthToken {
  AuthToken {
    policy_id: policy,
    name: auth.generate_token_name(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      prefix,
      string_utils.int_to_string(sequence),
    ),
  }
}

fn connection_id_from_token(token: AuthToken) -> ByteArray {
  auth.extract_token_sequence(token.name)
    |> connection_id_keys.format_connection_identifier
}

fn validate_parent_connection(
  inputs: List<Input>,
  outputs: List<Output>,
  connection_policy: PolicyId,
  expected_connection_id: ByteArray,
) -> ConnectionDatum {
  expect [input] = inputs_with_policy(inputs, connection_policy)
  expect [output] = outputs_with_policy(outputs, connection_policy)
  let token = canonical_token(input.output, connection_policy)
  expect canonical_token(output, connection_policy) == token
  expect input_datum: ConnectionDatum =
    validator_utils.get_inline_datum(input.output)
  expect output_datum: ConnectionDatum =
    validator_utils.get_inline_datum(output)
  expect and {
      input_datum.token == token,
      output_datum.token == token,
      connection_id_from_token(token) == expected_connection_id,
      output.address == input.output.address,
      auth.contains_only_auth_tokens(output, [token]),
      validate_increment_channel_count(input_datum, output_datum),
    }
  input_datum
}

fn create_client(
  host_policy: PolicyId,
  client_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  state_siblings: List<ByteArray>,
  consensus_siblings: List<ByteArray>,
  count_siblings: List<ByteArray>,
) -> Bool {
  expect inputs_with_policy(inputs, client_policy) == []
  expect [output] = outputs_with_policy(outputs, client_policy)
  let token =
    expected_token(
      host_policy,
      client_policy,
      client_id_keys.client_prefix,
      old.state.next_client_sequence,
    )
  expect canonical_token(output, client_policy) == token
  expect datum: ClientDatum = validator_utils.get_inline_datum(output)
  expect datum.token == token
  let client_id =
    "07-tendermint-"
      |> bytearray.concat(
          string_utils.int_to_string(old.state.next_client_sequence),
        )
  let latest = datum.state.client_state.latest_height
  expect [consensus] = pairs.get_all(datum.state.consensus_states, latest)
  let after_state =
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      client_keys.full_client_state_path(client_id),
      "",
      cbor.serialise(datum.state.client_state),
      state_siblings,
    )
  let after_consensus =
    ibc_state_commitment.apply_update(
      after_state,
      client_keys.full_client_consensus_state_path(
        client_id,
        string_utils.int_to_string(latest.revision_height),
      ),
      "",
      cbor.serialise(consensus),
      consensus_siblings,
    )
  and {
    client_reclamation.has_exactly_latest_consensus_state(datum),
    ibc_state_commitment.apply_update(
      after_consensus,
      reclamation.client_connection_count_path(client_id),
      "",
      reclamation.encode_count(0),
      count_siblings,
    ) == new.state.ibc_state_root,
  }
}

fn create_connection(
  host_policy: PolicyId,
  connection_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  connection_siblings: List<ByteArray>,
  count: Int,
  count_siblings: List<ByteArray>,
) -> Bool {
  expect inputs_with_policy(inputs, connection_policy) == []
  expect [output] = outputs_with_policy(outputs, connection_policy)
  let token =
    expected_token(
      host_policy,
      connection_policy,
      connection_id_keys.connection_prefix,
      old.state.next_connection_sequence,
    )
  expect canonical_token(output, connection_policy) == token
  expect datum: ConnectionDatum = validator_utils.get_inline_datum(output)
  expect datum.token == token
  let connection_id =
    string_utils.int_to_string(old.state.next_connection_sequence)
      |> connection_id_keys.format_connection_identifier
  let after_connection =
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      host_connection_keys.connection_path(connection_id),
      "",
      cbor.serialise(datum.state),
      connection_siblings,
    )
  and {
    count >= 0,
    ibc_state_commitment.apply_update(
      after_connection,
      reclamation.client_connection_count_path(datum.state.client_id),
      reclamation.encode_count(count),
      reclamation.encode_count(count + 1),
      count_siblings,
    ) == new.state.ibc_state_root,
  }
}

fn create_channel(
  host_policy: PolicyId,
  connection_policy: PolicyId,
  channel_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  reference_inputs: List<Input>,
  outputs: List<Output>,
  client_policy: PolicyId,
  validity_range: ValidityRange,
  channel_siblings: List<ByteArray>,
  send_siblings: List<ByteArray>,
  recv_siblings: List<ByteArray>,
  ack_siblings: List<ByteArray>,
) -> Bool {
  expect inputs_with_policy(inputs, channel_policy) == []
  expect [output] = outputs_with_policy(outputs, channel_policy)
  let token =
    expected_token(
      host_policy,
      channel_policy,
      channel_id_keys.channel_prefix,
      old.state.next_channel_sequence,
    )
  expect canonical_token(output, channel_policy) == token
  expect datum: ChannelDatum = validator_utils.get_inline_datum(output)
  expect datum.token == token
  expect [connection_id] = datum.state.channel.connection_hops
  let channel_id =
    string_utils.int_to_string(old.state.next_channel_sequence)
      |> channel_id_keys.format_channel_identifier
  let after_channel =
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      host_channel_keys.channel_path(datum.port_id, channel_id),
      "",
      cbor.serialise(datum.state.channel),
      channel_siblings,
    )
  let after_send =
    ibc_state_commitment.apply_update(
      after_channel,
      packet_keys.next_sequence_send_path(datum.port_id, channel_id),
      "",
      cbor.serialise(datum.state.next_sequence_send),
      send_siblings,
    )
  let after_recv =
    ibc_state_commitment.apply_update(
      after_send,
      packet_keys.next_sequence_recv_path(datum.port_id, channel_id),
      "",
      cbor.serialise(datum.state.next_sequence_recv),
      recv_siblings,
    )
  let connection_datum =
    validate_parent_connection(
      inputs,
      outputs,
      connection_policy,
      connection_id,
    )
  let client_datum =
    validator_utils.validate_referred_client(
      reference_inputs,
      token.name,
      client_policy,
      connection_datum.state.client_id,
    )
  expect [connection_version] = connection_datum.state.versions
  and {
    auth.contains_only_auth_tokens(output, [token]),
    order.string(datum.state.channel.ordering)
      |> version.verify_supported_feature(connection_version, _),
    client_state.status(
      client_datum.state.client_state,
      validator_utils.get_tx_valid_to(validity_range) * 1_000_000,
      client_datum.state.consensus_states,
    ) == Active,
    ibc_state_commitment.apply_update(
      after_recv,
      packet_keys.next_sequence_ack_path(datum.port_id, channel_id),
      "",
      cbor.serialise(datum.state.next_sequence_ack),
      ack_siblings,
    ) == new.state.ibc_state_root,
  }
}

validator mint_lifecycle_creation_marker(
  host_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  channel_policy: PolicyId,
) {
  mint(
    redeemer: LifecycleCreationMarkerRedeemer,
    own_policy: PolicyId,
    transaction: Transaction,
  ) {
    let AuthorizeCreation = redeemer
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      mint,
      redeemers,
      validity_range,
      ..
    } = transaction
    let (host_input, host_output, old, new) =
      host_thread(inputs, outputs, host_policy)
    expect Some(raw_host_redeemer) =
      pairs.get_first(redeemers, Spend(host_input.output_reference))
    expect host_redeemer: HostStateRedeemer = raw_host_redeemer
    expect
      auth.mint_auth_token(
        mint,
        AuthToken { policy_id: own_policy, name: lifecycle_marker_token_name },
      )
    expect
      quantity_of(host_output.value, own_policy, lifecycle_marker_token_name) == quantity_of(
        host_input.output.value,
        own_policy,
        lifecycle_marker_token_name,
      ) + 1

    when host_redeemer is {
      CreateClient {
        client_state_siblings,
        consensus_state_siblings,
        client_connection_count_siblings,
      } ->
        create_client(
          host_policy,
          client_policy,
          old,
          new,
          inputs,
          outputs,
          client_state_siblings,
          consensus_state_siblings,
          client_connection_count_siblings,
        )
      CreateConnection {
        connection_siblings,
        client_connection_count,
        client_connection_count_siblings,
      } ->
        create_connection(
          host_policy,
          connection_policy,
          old,
          new,
          inputs,
          outputs,
          connection_siblings,
          client_connection_count,
          client_connection_count_siblings,
        )
      CreateChannel {
        channel_siblings,
        next_sequence_send_siblings,
        next_sequence_recv_siblings,
        next_sequence_ack_siblings,
      } ->
        create_channel(
          host_policy,
          connection_policy,
          channel_policy,
          old,
          new,
          inputs,
          reference_inputs,
          outputs,
          client_policy,
          validity_range,
          channel_siblings,
          next_sequence_send_siblings,
          next_sequence_recv_siblings,
          next_sequence_ack_siblings,
        )
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
