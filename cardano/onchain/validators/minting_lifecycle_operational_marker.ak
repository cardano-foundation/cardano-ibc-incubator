use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/primitive/bytearray
use cardano/address
use cardano/assets.{AssetName, PolicyId, quantity_of, tokens}
use cardano/transaction.{
  Input, Output, Redeemer, ScriptPurpose, Spend, Transaction, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum} as client_datum
use ibc/client/ics_007_tendermint_client/client_redeemer as client_redeemer
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour_handle
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/keys as connection_id_keys
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/types/keys as channel_id_keys
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, ModuleRegistration, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, HostStateRedeemer, UpdateChannel, UpdateClient, UpdateConnection,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizeOperation, LifecycleOperationalMarkerRedeemer,
  lifecycle_marker_token_name,
}
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

fn inputs_with_policy(inputs: List<Input>, policy: PolicyId) -> List<Input> {
  list.filter(
    inputs,
    fn(input) { !(input.output.value |> tokens(policy) |> dict.is_empty) },
  )
}

fn outputs_with_policy(outputs: List<Output>, policy: PolicyId) -> List<Output> {
  list.filter(
    outputs,
    fn(output) { !(output.value |> tokens(policy) |> dict.is_empty) },
  )
}

fn canonical_token(output: Output, policy: PolicyId) -> AuthToken {
  expect [Pair(name, 1)] = output.value |> tokens(policy) |> dict.to_pairs
  AuthToken { policy_id: policy, name }
}

fn client_id(token_name: AssetName) -> ByteArray {
  "07-tendermint-" |> bytearray.concat(auth.extract_token_sequence(token_name))
}

fn connection_id(token_name: AssetName) -> ByteArray {
  auth.extract_token_sequence(token_name)
    |> connection_id_keys.format_connection_identifier
}

fn channel_id(token_name: AssetName) -> ByteArray {
  auth.extract_token_sequence(token_name)
    |> channel_id_keys.format_channel_identifier
}

fn apply_removed_consensus_state_updates(
  root: ByteArray,
  id: ByteArray,
  removed: Pairs<Height, ConsensusState>,
  witnesses: List<List<ByteArray>>,
) -> ByteArray {
  when removed is {
    [] -> {
      expect witnesses == []
      root
    }
    [Pair(height, consensus), ..rest] -> {
      expect [siblings, ..remaining] = witnesses
      apply_removed_consensus_state_updates(
        ibc_state_commitment.apply_update(
          root,
          client_keys.full_client_consensus_state_path(
            id,
            string_utils.int_to_string(height.revision_height),
          ),
          cbor.serialise(consensus),
          "",
          siblings,
        ),
        id,
        rest,
        remaining,
      )
    }
  }
}

fn validate_update_client(
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  client_policy: PolicyId,
  client_script_hash: Hash<Blake2b_224, Script>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  validity_range: ValidityRange,
  state_siblings: List<ByteArray>,
  consensus_siblings: List<ByteArray>,
  removed_siblings: List<List<ByteArray>>,
) -> Bool {
  expect [input] = inputs_with_policy(inputs, client_policy)
  expect [output] = outputs_with_policy(outputs, client_policy)
  let token = canonical_token(input.output, client_policy)
  expect canonical_token(output, client_policy) == token
  expect
    input.output.address.payment_credential == address.Script(
      client_script_hash,
    )
  expect output.address == input.output.address
  expect input_datum: ClientDatum =
    validator_utils.get_inline_datum(input.output)
  expect output_datum: ClientDatum = validator_utils.get_inline_datum(output)
  expect input_datum.token == token
  expect output_datum.token == token
  expect auth.contains_only_auth_tokens(output, [token])
  expect Some(raw_client_redeemer) =
    pairs.get_first(redeemers, Spend(input.output_reference))
  expect client_redeemer.UpdateClient { msg }: client_redeemer.SpendClientRedeemer =
    raw_client_redeemer
  let valid_from = validator_utils.get_tx_valid_from(validity_range)
  let valid_to = validator_utils.get_tx_valid_to(validity_range)
  expect
    client_state.status(
      input_datum.state.client_state,
      valid_to * 1_000_000,
      input_datum.state.consensus_states,
    ) == Active
  let valid_transition =
    if misbehaviour_handle.check_for_misbehaviour(
      msg,
      input_datum.state.consensus_states,
    ) {
      client_datum.update_state_on_misbehaviour(input_datum, output_datum)
    } else {
      expect HeaderCase(header) = msg
      client_datum.update_state(input_datum, output_datum, header, valid_from)
    }
  let id = client_id(token.name)
  let after_state =
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      client_keys.full_client_state_path(id),
      cbor.serialise(input_datum.state.client_state),
      cbor.serialise(output_datum.state.client_state),
      state_siblings,
    )
  let input_consensus = input_datum.state.consensus_states
  let output_consensus = output_datum.state.consensus_states
  let removed =
    list.filter(
      input_consensus,
      fn(pair) { !pairs.has_key(output_consensus, pair.1st) },
    )
  let after_removed =
    apply_removed_consensus_state_updates(
      after_state,
      id,
      removed,
      removed_siblings,
    )
  let added =
    list.filter(
      output_consensus,
      fn(pair) { !pairs.has_key(input_consensus, pair.1st) },
    )
  let final_root =
    when added is {
      [] -> after_removed
      [Pair(height, consensus)] ->
        ibc_state_commitment.apply_update(
          after_removed,
          client_keys.full_client_consensus_state_path(
            id,
            string_utils.int_to_string(height.revision_height),
          ),
          "",
          cbor.serialise(consensus),
          consensus_siblings,
        )
      _ -> fail
    }
  and {
    valid_transition,
    final_root == new.state.ibc_state_root,
  }
}

fn validate_bind_port(
  old: HostStateDatum,
  new: HostStateDatum,
  outputs: List<Output>,
  port_id: ByteArray,
  registration: ModuleRegistration,
  siblings: List<ByteArray>,
) -> Bool {
  expect [module_output] =
    transaction.find_script_outputs(outputs, registration.module_script_hash)
  let path =
    key_port_prefix |> bytearray.concat("/") |> bytearray.concat(port_id)
  and {
    ibc_state_commitment.apply_update(
      old.state.ibc_state_root,
      path,
      "",
      cbor.serialise(registration),
      siblings,
    ) == new.state.ibc_state_root,
    auth.contains_only_auth_tokens(
      module_output,
      [registration.port_token, registration.module_token],
    ),
  }
}

fn validate_update_connection(
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  policy: PolicyId,
  script_hash: Hash<Blake2b_224, Script>,
  siblings: List<ByteArray>,
) -> Bool {
  expect [input] = inputs_with_policy(inputs, policy)
  expect [output] = outputs_with_policy(outputs, policy)
  let token = canonical_token(input.output, policy)
  expect canonical_token(output, policy) == token
  expect input.output.address.payment_credential == address.Script(script_hash)
  expect output.address == input.output.address
  expect input_datum: ConnectionDatum =
    validator_utils.get_inline_datum(input.output)
  expect output_datum: ConnectionDatum =
    validator_utils.get_inline_datum(output)
  expect input_datum.token == token
  expect output_datum.token == token
  expect auth.contains_only_auth_tokens(output, [token])
  ibc_state_commitment.apply_update(
    old.state.ibc_state_root,
    connection_keys.connection_path(connection_id(token.name)),
    cbor.serialise(input_datum.state),
    cbor.serialise(output_datum.state),
    siblings,
  ) == new.state.ibc_state_root
}

fn channel_thread(
  inputs: List<Input>,
  outputs: List<Output>,
  policy: PolicyId,
  script_hash: Hash<Blake2b_224, Script>,
) -> (Input, Output, ChannelDatum, ChannelDatum) {
  expect [input] = inputs_with_policy(inputs, policy)
  expect [output] = outputs_with_policy(outputs, policy)
  let token = canonical_token(input.output, policy)
  expect canonical_token(output, policy) == token
  expect input.output.address.payment_credential == address.Script(script_hash)
  expect output.address == input.output.address
  expect input_datum: ChannelDatum =
    validator_utils.get_inline_datum(input.output)
  expect output_datum: ChannelDatum = validator_utils.get_inline_datum(output)
  expect input_datum.token == token
  expect output_datum.token == token
  expect auth.contains_only_auth_tokens(output, [token])
  (input, output, input_datum, output_datum)
}

fn validate_update_channel(
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  policy: PolicyId,
  script_hash: Hash<Blake2b_224, Script>,
  siblings: List<ByteArray>,
) -> Bool {
  let (_, _, input_datum, output_datum) =
    channel_thread(inputs, outputs, policy, script_hash)
  expect
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: output_datum.state.channel,
      },
    } == output_datum
  ibc_state_commitment.apply_update(
    old.state.ibc_state_root,
    channel_keys.channel_path(
      output_datum.port_id,
      channel_id(output_datum.token.name),
    ),
    cbor.serialise(input_datum.state.channel),
    cbor.serialise(output_datum.state.channel),
    siblings,
  ) == new.state.ibc_state_root
}

validator mint_lifecycle_operational_marker(
  host_policy: PolicyId,
  client_script_hash: Hash<Blake2b_224, Script>,
  connection_script_hash: Hash<Blake2b_224, Script>,
  channel_script_hash: Hash<Blake2b_224, Script>,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  channel_policy: PolicyId,
) {
  mint(
    redeemer: LifecycleOperationalMarkerRedeemer,
    own_policy: PolicyId,
    transaction: Transaction,
  ) {
    let AuthorizeOperation = redeemer
    let Transaction { inputs, outputs, mint, redeemers, validity_range, .. } =
      transaction
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
      BindPort { port_id, registration, port_siblings } ->
        validate_bind_port(
          old,
          new,
          outputs,
          port_id,
          registration,
          port_siblings,
        )
      UpdateClient {
        client_state_siblings,
        consensus_state_siblings,
        removed_consensus_state_siblings,
      } ->
        validate_update_client(
          old,
          new,
          inputs,
          outputs,
          client_policy,
          client_script_hash,
          redeemers,
          validity_range,
          client_state_siblings,
          consensus_state_siblings,
          removed_consensus_state_siblings,
        )
      UpdateConnection { connection_siblings } ->
        validate_update_connection(
          old,
          new,
          inputs,
          outputs,
          connection_policy,
          connection_script_hash,
          connection_siblings,
        )
      UpdateChannel { channel_siblings } ->
        validate_update_channel(
          old,
          new,
          inputs,
          outputs,
          channel_policy,
          channel_script_hash,
          channel_siblings,
        )
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
