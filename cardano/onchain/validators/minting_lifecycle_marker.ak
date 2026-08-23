use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address
use cardano/assets.{AssetName, PolicyId, quantity_of, tokens}
use cardano/transaction.{
  Input, Output, Redeemer, ScriptPurpose, Spend, Transaction, ValidityRange,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/transfer_module_datum.{TransferModuleDatum}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_reclamation
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionDatum, validate_decrement_channel_count,
  validate_increment_channel_count,
}
use ibc/core/ics_003_connection_semantics/types/keys as connection_id_keys
use ibc/core/ics_004/channel_datum.{Abandoning, ChannelDatum}
use ibc/core/ics_004/types/keys as channel_id_keys
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnChanReclaim, OnHostStateSeal,
}
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, ModuleRegistration, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HostStateRedeemer, PruneTerminalClient, ReclaimChannel, ReclaimClient,
  ReclaimConnection, ReclaimModule,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizeLifecycle, AuthorizeTransferChannelReclaim,
  AuthorizeTransferModuleReclaim, LifecycleMarkerRedeemer,
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
  let host_token =
    AuthToken { policy_id: host_policy, name: host_state_token_name }
  expect [host_input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, host_token) },
    )
  expect [host_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, host_token) },
    )
  expect host_output.address == host_input.output.address
  expect old_datum: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  expect new_datum: HostStateDatum =
    validator_utils.get_inline_datum(host_output)
  expect old_datum.nft_policy == host_policy
  expect new_datum.nft_policy == host_policy
  (host_input, host_output, old_datum, new_datum)
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

fn canonical_policy_token(output: Output, policy: PolicyId) -> AuthToken {
  expect [Pair(name, 1)] = output.value |> tokens(policy) |> dict.to_pairs
  AuthToken { policy_id: policy, name }
}

fn client_id_from_token_name(token_name: AssetName) -> ByteArray {
  "07-tendermint-" |> bytearray.concat(auth.extract_token_sequence(token_name))
}

fn connection_id_from_token_name(token_name: AssetName) -> ByteArray {
  auth.extract_token_sequence(token_name)
    |> connection_id_keys.format_connection_identifier
}

fn channel_id_from_token_name(token_name: AssetName) -> ByteArray {
  auth.extract_token_sequence(token_name)
    |> channel_id_keys.format_channel_identifier
}

fn validate_parent_connection_count_change(
  inputs: List<Input>,
  outputs: List<Output>,
  connection_policy: PolicyId,
  expected_connection_id: ByteArray,
  increment: Bool,
) -> Bool {
  expect [connection_input] = inputs_with_policy(inputs, connection_policy)
  expect [connection_output] = outputs_with_policy(outputs, connection_policy)
  let token = canonical_policy_token(connection_input.output, connection_policy)
  expect canonical_policy_token(connection_output, connection_policy) == token
  expect input_datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_input.output)
  expect output_datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_output)
  and {
    input_datum.token == token,
    output_datum.token == token,
    connection_id_from_token_name(token.name) == expected_connection_id,
    connection_output.address == connection_input.output.address,
    auth.contains_only_auth_tokens(connection_output, [token]),
    if increment {
      validate_increment_channel_count(input_datum, output_datum)
    } else {
      validate_decrement_channel_count(input_datum, output_datum)
    },
  }
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

fn module_redeemer(
  input: Input,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> IBCModuleRedeemer {
  expect Some(raw) = pairs.get_first(redeemers, Spend(input.output_reference))
  expect decoded: IBCModuleRedeemer = raw
  decoded
}

fn registered_module(
  host_datum: HostStateDatum,
  port_id: ByteArray,
  inputs: List<Input>,
) -> (ModuleRegistration, Input) {
  expect Some(registration) =
    pairs.get_first(host_datum.state.bound_port, port_id)
  (registration, module_input_for_registration(inputs, registration))
}

fn apply_removed_consensus_state_updates(
  root: ByteArray,
  client_id: ByteArray,
  removed: Pairs<Height, ConsensusState>,
  witnesses: List<List<ByteArray>>,
) -> ByteArray {
  when removed is {
    [] -> {
      expect witnesses == []
      root
    }
    [Pair(height, consensus), ..rest] -> {
      expect [siblings, ..remaining_witnesses] = witnesses
      apply_removed_consensus_state_updates(
        ibc_state_commitment.apply_update(
          root,
          client_keys.full_client_consensus_state_path(
            client_id,
            string_utils.int_to_string(height.revision_height),
          ),
          cbor.serialise(consensus),
          "",
          siblings,
        ),
        client_id,
        rest,
        remaining_witnesses,
      )
    }
  }
}

fn validate_prune_client(
  client_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  validity_range: ValidityRange,
  witnesses: List<List<ByteArray>>,
) -> Bool {
  expect [client_input] = inputs_with_policy(inputs, client_policy)
  expect [client_output] = outputs_with_policy(outputs, client_policy)
  let token = canonical_policy_token(client_input.output, client_policy)
  expect canonical_policy_token(client_output, client_policy) == token
  expect input_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect output_datum: ClientDatum =
    validator_utils.get_inline_datum(client_output)
  expect input_datum.token == token
  expect output_datum.token == token
  let removed =
    list.filter(
      input_datum.state.consensus_states,
      fn(pair) { !pairs.has_key(output_datum.state.consensus_states, pair.1st) },
    )
  let valid_from = validator_utils.get_tx_valid_from(validity_range)
  and {
    client_output.address == client_input.output.address,
    auth.contains_only_auth_tokens(client_output, [token]),
    list.length(witnesses) == client_reclamation.terminal_prune_count(
      input_datum,
    ),
    client_reclamation.validate_prune_terminal_consensus_states(
      input_datum,
      output_datum,
      valid_from,
    ),
    apply_removed_consensus_state_updates(
      old.state.ibc_state_root,
      client_id_from_token_name(token.name),
      removed,
      witnesses,
    ) == new.state.ibc_state_root,
  }
}

fn validate_reclaim_client(
  client_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  validity_range: ValidityRange,
  client_state_siblings: List<ByteArray>,
  consensus_siblings: List<ByteArray>,
  count_siblings: List<ByteArray>,
) -> Bool {
  expect [client_input] = inputs_with_policy(inputs, client_policy)
  expect outputs_with_policy(outputs, client_policy) == []
  let token = canonical_policy_token(client_input.output, client_policy)
  expect datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect datum.token == token
  expect [Pair(latest, consensus)] = datum.state.consensus_states
  expect latest == datum.state.client_state.latest_height
  let client_id = client_id_from_token_name(token.name)
  let after_client =
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      client_keys.full_client_state_path(client_id),
      cbor.serialise(datum.state.client_state),
      "",
      client_state_siblings,
    )
  let after_consensus =
    ibc_state_commitment.apply_update(
      after_client,
      client_keys.full_client_consensus_state_path(
        client_id,
        string_utils.int_to_string(latest.revision_height),
      ),
      cbor.serialise(consensus),
      "",
      consensus_siblings,
    )
  and {
    client_reclamation.is_terminal_at(
      datum,
      validator_utils.get_tx_valid_from(validity_range),
    ),
    client_reclamation.has_exactly_latest_consensus_state(datum),
    ibc_state_commitment.apply_update(
      after_consensus,
      reclamation.client_connection_count_path(client_id),
      reclamation.encode_count(0),
      "",
      count_siblings,
    ) == new.state.ibc_state_root,
  }
}

fn validate_reclaim_connection(
  connection_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  connection_siblings: List<ByteArray>,
  client_connection_count: Int,
  count_siblings: List<ByteArray>,
) -> Bool {
  expect [connection_input] = inputs_with_policy(inputs, connection_policy)
  expect outputs_with_policy(outputs, connection_policy) == []
  let token = canonical_policy_token(connection_input.output, connection_policy)
  expect datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_input.output)
  expect datum.token == token
  let after_connection =
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      host_connection_keys.connection_path(
        connection_id_from_token_name(token.name),
      ),
      cbor.serialise(datum.state),
      "",
      connection_siblings,
    )
  and {
    client_connection_count > 0,
    ibc_state_commitment.apply_update(
      after_connection,
      reclamation.client_connection_count_path(datum.state.client_id),
      reclamation.encode_count(client_connection_count),
      reclamation.encode_count(client_connection_count - 1),
      count_siblings,
    ) == new.state.ibc_state_root,
  }
}

fn validate_reclaim_channel(
  connection_policy: PolicyId,
  channel_policy: PolicyId,
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_siblings: List<ByteArray>,
  send_siblings: List<ByteArray>,
  recv_siblings: List<ByteArray>,
  ack_siblings: List<ByteArray>,
  transfer_checks: Bool,
) -> Bool {
  expect [channel_input] = inputs_with_policy(inputs, channel_policy)
  expect outputs_with_policy(outputs, channel_policy) == []
  let token = canonical_policy_token(channel_input.output, channel_policy)
  expect datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)
  expect datum.token == token
  expect [connection_id] = datum.state.channel.connection_hops
  let channel_id = channel_id_from_token_name(token.name)
  let is_abandoned =
    when datum.lifecycle is {
      Abandoning { .. } -> True
      _ -> False
    }
  let expected_root =
    if is_abandoned {
      let after_channel =
        ibc_state_commitment.apply_update(
          old.state.ibc_state_root,
          host_channel_keys.channel_path(datum.port_id, channel_id),
          cbor.serialise(datum.state.channel),
          "",
          channel_siblings,
        )
      let after_send =
        ibc_state_commitment.apply_update(
          after_channel,
          packet_keys.next_sequence_send_path(datum.port_id, channel_id),
          cbor.serialise(datum.state.next_sequence_send),
          "",
          send_siblings,
        )
      let after_recv =
        ibc_state_commitment.apply_update(
          after_send,
          packet_keys.next_sequence_recv_path(datum.port_id, channel_id),
          cbor.serialise(datum.state.next_sequence_recv),
          "",
          recv_siblings,
        )
      ibc_state_commitment.apply_update(
        after_recv,
        packet_keys.next_sequence_ack_path(datum.port_id, channel_id),
        cbor.serialise(datum.state.next_sequence_ack),
        "",
        ack_siblings,
      )
    } else {
      expect channel_siblings == []
      expect recv_siblings == []
      let after_send =
        ibc_state_commitment.apply_update(
          old.state.ibc_state_root,
          packet_keys.next_sequence_send_path(datum.port_id, channel_id),
          cbor.serialise(datum.state.next_sequence_send),
          "",
          send_siblings,
        )
      ibc_state_commitment.apply_update(
        after_send,
        packet_keys.next_sequence_ack_path(datum.port_id, channel_id),
        cbor.serialise(datum.state.next_sequence_ack),
        "",
        ack_siblings,
      )
    }
  let (registration, module_input) =
    registered_module(old, datum.port_id, inputs)
  expect Callback(OnChanReclaim {
    channel_id: callback_channel_id,
    channel_live_escrow_shard_count_siblings,
  }) = module_redeemer(module_input, redeemers)
  and {
    callback_channel_id == channel_id,
    validate_parent_connection_count_change(
      inputs,
      outputs,
      connection_policy,
      connection_id,
      False,
    ),
    expected_root == new.state.ibc_state_root,
    if transfer_checks {
      validate_transfer_channel_reclaim(
        module_input,
        registration,
        outputs,
        datum.voucher_supply,
        channel_id,
        channel_live_escrow_shard_count_siblings,
      )
    } else {
      True
    },
  }
}

fn validate_transfer_channel_reclaim(
  module_input: Input,
  registration: ModuleRegistration,
  outputs: List<Output>,
  channel_voucher_supply: Int,
  channel_id: ByteArray,
  siblings: List<ByteArray>,
) -> Bool {
  expect datum: TransferModuleDatum =
    validator_utils.get_inline_datum(module_input.output)
  expect [module_output] =
    list.filter(
      outputs,
      fn(output) {
        output.address == module_input.output.address && auth.contains_only_auth_tokens(
          output,
          [registration.port_token, registration.module_token],
        )
      },
    )
  expect output_datum: TransferModuleDatum =
    validator_utils.get_inline_datum(module_output)
  and {
    channel_voucher_supply == 0,
    output_datum == datum,
    datum.live_escrow_shard_count >= 0,
    ibc_state_commitment.apply_update(
      datum.escrow_shard_registry_root,
      transfer_escrow_shard.channel_live_shard_count_key(channel_id),
      "",
      "",
      siblings,
    ) == datum.escrow_shard_registry_root,
    assets.match_assets(module_output.value, module_input.output.value),
    assets.lovelace_of(module_output.value) >= assets.lovelace_of(
      module_input.output.value,
    ),
  }
}

fn validate_module_reclaim(
  old: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  port_id: ByteArray,
  transfer_checks: Bool,
) -> Bool {
  let (registration, module_input) = registered_module(old, port_id, inputs)
  expect module_redeemer(module_input, redeemers) == Callback(OnHostStateSeal)
  if transfer_checks {
    expect datum: TransferModuleDatum =
      validator_utils.get_inline_datum(module_input.output)
    and {
      datum.live_escrow_shard_count == 0,
      datum.voucher_supply == 0,
      validator_utils.validate_terminal_module_root_payout(
        module_input.output,
        outputs,
        registration.port_token,
        registration.module_token,
        old.deployer,
      ),
    }
  } else {
    True
  }
}

validator mint_lifecycle_marker(
  host_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  channel_policy: PolicyId,
) {
  mint(
    redeemer: LifecycleMarkerRedeemer,
    own_policy: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, redeemers, validity_range, .. } =
      transaction
    let (host_input, host_output, old, new) =
      host_thread(inputs, outputs, host_policy)
    expect Some(raw_host_redeemer) =
      pairs.get_first(redeemers, Spend(host_input.output_reference))
    expect host_redeemer: HostStateRedeemer = raw_host_redeemer
    let marker =
      AuthToken { policy_id: own_policy, name: lifecycle_marker_token_name }
    expect auth.mint_auth_token(mint, marker)
    expect
      quantity_of(host_output.value, own_policy, lifecycle_marker_token_name) == quantity_of(
        host_input.output.value,
        own_policy,
        lifecycle_marker_token_name,
      ) + 1

    when redeemer is {
      AuthorizeLifecycle ->
        when host_redeemer is {
          PruneTerminalClient { removed_consensus_state_siblings } ->
            validate_prune_client(
              client_policy,
              old,
              new,
              inputs,
              outputs,
              validity_range,
              removed_consensus_state_siblings,
            )
          ReclaimClient {
            client_state_siblings,
            consensus_state_siblings,
            client_connection_count_siblings,
            ..
          } ->
            validate_reclaim_client(
              client_policy,
              old,
              new,
              inputs,
              outputs,
              validity_range,
              client_state_siblings,
              consensus_state_siblings,
              client_connection_count_siblings,
            )
          ReclaimConnection {
            connection_siblings,
            client_connection_count,
            client_connection_count_siblings,
            ..
          } ->
            validate_reclaim_connection(
              connection_policy,
              old,
              new,
              inputs,
              outputs,
              connection_siblings,
              client_connection_count,
              client_connection_count_siblings,
            )
          ReclaimChannel {
            channel_siblings,
            next_sequence_send_siblings,
            next_sequence_recv_siblings,
            next_sequence_ack_siblings,
            ..
          } ->
            validate_reclaim_channel(
              connection_policy,
              channel_policy,
              old,
              new,
              inputs,
              outputs,
              redeemers,
              channel_siblings,
              next_sequence_send_siblings,
              next_sequence_recv_siblings,
              next_sequence_ack_siblings,
              False,
            )
          ReclaimModule { port_id } ->
            validate_module_reclaim(
              old,
              inputs,
              outputs,
              redeemers,
              port_id,
              False,
            )
          _ -> False
        }
      AuthorizeTransferChannelReclaim { port_id, port_token, module_token } -> {
        expect ReclaimChannel {
          channel_siblings,
          next_sequence_send_siblings,
          next_sequence_recv_siblings,
          next_sequence_ack_siblings,
          ..
        } = host_redeemer
        expect [channel_input] = inputs_with_policy(inputs, channel_policy)
        expect channel_datum: ChannelDatum =
          validator_utils.get_inline_datum(channel_input.output)
        expect channel_datum.port_id == port_id
        expect Some(registration) =
          pairs.get_first(old.state.bound_port, port_id)
        expect registration.port_token == port_token
        expect registration.module_token == module_token
        validate_reclaim_channel(
          connection_policy,
          channel_policy,
          old,
          new,
          inputs,
          outputs,
          redeemers,
          channel_siblings,
          next_sequence_send_siblings,
          next_sequence_recv_siblings,
          next_sequence_ack_siblings,
          True,
        )
      }
      AuthorizeTransferModuleReclaim { port_id, port_token, module_token } -> {
        expect ReclaimModule { port_id: reclaimed_port_id } = host_redeemer
        expect reclaimed_port_id == port_id
        expect Some(registration) =
          pairs.get_first(old.state.bound_port, port_id)
        expect registration.port_token == port_token
        expect registration.module_token == module_token
        validate_module_reclaim(old, inputs, outputs, redeemers, port_id, True)
      }
    }
  }

  else(_) {
    fail
  }
}
