use aiken/cbor
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use host_state_stt
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order as channel_order
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/keys as port_id_keys
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, empty_ibc_state_root, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, HandlePacket, HostStateRedeemer, UpdateChannel,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment

// Build a list with `count` copies of `value`.
fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn port_commitment_key(port: Int) -> ByteArray {
  let port_id = port_id_keys.format_port_identifier(port)
  key_port_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(port_id)
}

fn test_channel_token() -> AuthToken {
  let base_token =
    AuthToken { policy_id: "mock base token policy", name: "mock base token" }
  AuthToken {
    policy_id: "mock channel policy",
    name: auth.generate_token_name(base_token, channel_keys.channel_prefix, "0"),
  }
}

fn test_channel(state: channel_state.ChannelState) -> Channel {
  Channel {
    state,
    ordering: channel_order.Unordered,
    counterparty: ChannelCounterparty {
      port_id: "transfer",
      channel_id: "channel-1",
    },
    connection_hops: ["connection-0"],
    version: "ics20-1",
  }
}

fn test_channel_datum(
  channel: Channel,
  next_sequence_send: Int,
  packet_commitment: Pairs<Int, ByteArray>,
) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel,
      next_sequence_send,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment,
      packet_receipt: [],
      packet_acknowledgement: [],
    },
    port_id: "transfer",
    token: test_channel_token(),
  }
}

test host_state_bind_port_succeeds_with_correct_root_witness() {
  // -------------------------------------------------------------------------
  // Arrange: a starting HostState UTxO with an empty commitment root.
  // -------------------------------------------------------------------------
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

  // These parameters are required by the validator type, but BindPort does not
  // use them. We still provide valid-looking script hashes.
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"

  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let old_datum = HostStateDatum { state: old_state, nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  // -------------------------------------------------------------------------
  // Arrange: the updated HostState UTxO after binding one port.
  // -------------------------------------------------------------------------
  let port = 99

  // For an empty tree, every sibling hash along the path is the empty hash.
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port)
  let port_value = cbor.serialise(port)

  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_key,
      "",
      port_value,
      port_siblings,
    )

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: [port],
    }

  let new_datum = HostStateDatum { state: new_state, nft_policy }

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // -------------------------------------------------------------------------
  // Act: evaluate the HostState STT validator for BindPort.
  // -------------------------------------------------------------------------
  let redeemer: HostStateRedeemer = BindPort { port, port_siblings }

  let transaction =
    Transaction { ..placeholder, inputs: [host_input], outputs: [host_output] }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_bind_port_fails_with_arbitrary_root() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let old_datum = HostStateDatum { state: old_state, nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let port = 99
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  // Intentionally set the new root to an arbitrary value (the old root).
  // The validator must reject this because the witness implies a different root.
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: empty_ibc_state_root,
      bound_port: [port],
    }

  let new_datum = HostStateDatum { state: new_state, nft_policy }

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: HostStateRedeemer = BindPort { port, port_siblings }

  let transaction =
    Transaction { ..placeholder, inputs: [host_input], outputs: [host_output] }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_cannot_move_nft_to_different_address() fail {
  // Arrange: a valid HostState input at the HostState script address.
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"

  let original_address = Address(Script(dummy_script_hash), None)

  let moved_address =
    Address(
      Script(#"00000000000000000000000000000000000000000000000000000000"),
      None,
    )

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let old_datum = HostStateDatum { state: old_state, nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: original_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  // Arrange: a valid state transition (BindPort) that would succeed, except the
  // output tries to move the NFT to a different address.
  let port = 99
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port)
  let port_value = cbor.serialise(port)

  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_key,
      "",
      port_value,
      port_siblings,
    )

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: [port],
    }

  let new_datum = HostStateDatum { state: new_state, nft_policy }

  let host_output =
    Output {
      address: moved_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: HostStateRedeemer = BindPort { port, port_siblings }

  let transaction =
    Transaction { ..placeholder, inputs: [host_input], outputs: [host_output] }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_bind_port_fails_without_required_sibling_hashes() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let old_datum = HostStateDatum { state: old_state, nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let port = 99

  // Compute the correct new root (still using the full witness list) so that the
  // only mismatch is the missing witness carried in the redeemer.
  let full_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port)
  let port_value = cbor.serialise(port)
  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_key,
      "",
      port_value,
      full_siblings,
    )

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: [port],
    }

  let new_datum = HostStateDatum { state: new_state, nft_policy }

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // Pass an empty witness list. The validator expects exactly `merkle_depth_bits`
  // hashes, so this must fail.
  let redeemer: HostStateRedeemer = BindPort { port, port_siblings: [] }

  let transaction =
    Transaction { ..placeholder, inputs: [host_input], outputs: [host_output] }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_bind_port_fails_if_output_missing() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let address = Address(Script(dummy_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let old_datum = HostStateDatum { state: old_state, nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let port = 99
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let redeemer: HostStateRedeemer = BindPort { port, port_siblings }

  // No HostState output is produced, so the STT validator must fail.
  let transaction =
    Transaction { ..placeholder, inputs: [host_input], outputs: [] }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

test host_state_update_channel_rejects_packet_field_changes() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let channel_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"

  let channel_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])

  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let channel_value = cbor.serialise(input_channel_datum.state.channel)
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      channel_key,
      "",
      channel_value,
      channel_siblings,
    )

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: old_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }

  let host_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_address = Address(Script(host_script_hash), None)
  let host_input =
    Input(
      host_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(HostStateDatum { state: old_state, nft_policy }),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address: host_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(HostStateDatum { state: new_state, nft_policy }),
      reference_script: None,
    }

  let output_channel_datum =
    test_channel_datum(
      test_channel(channel_state.Open),
      2,
      [Pair(1, #"010203")],
    )

  let channel_token = test_channel_token()
  let channel_input =
    Input(
      OutputReference {
        transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
        output_index: 0,
      },
      Output {
        address: Address(Script(channel_script_hash), None),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(input_channel_datum),
        reference_script: None,
      },
    )

  let channel_output =
    Output {
      address: Address(Script(channel_script_hash), None),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(output_channel_datum),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input, channel_input],
      outputs: [host_output, channel_output],
    }

  let redeemer: HostStateRedeemer = UpdateChannel { channel_siblings }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    host_script_hash,
    host_script_hash,
    channel_script_hash,
    None,
    redeemer,
    host_ref,
    transaction,
  )
}

test host_state_handle_packet_rejects_channel_only_changes() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let channel_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"

  let channel_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let input_channel = test_channel(channel_state.Open)
  let output_channel = test_channel(channel_state.Closed)
  let input_channel_datum = test_channel_datum(input_channel, 1, [])
  let output_channel_datum = test_channel_datum(output_channel, 1, [])

  let channel_key = host_channel_keys.channel_path("transfer", "channel-0")
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      channel_key,
      "",
      cbor.serialise(input_channel),
      channel_siblings,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      old_root,
      channel_key,
      cbor.serialise(input_channel),
      cbor.serialise(output_channel),
      channel_siblings,
    )

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: old_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  let host_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_address = Address(Script(host_script_hash), None)
  let host_input =
    Input(
      host_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(HostStateDatum { state: old_state, nft_policy }),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address: host_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(HostStateDatum { state: new_state, nft_policy }),
      reference_script: None,
    }

  let channel_token = test_channel_token()
  let channel_input =
    Input(
      OutputReference {
        transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
        output_index: 0,
      },
      Output {
        address: Address(Script(channel_script_hash), None),
        value: from_asset(channel_token.policy_id, channel_token.name, 1),
        datum: InlineDatum(input_channel_datum),
        reference_script: None,
      },
    )

  let channel_output =
    Output {
      address: Address(Script(channel_script_hash), None),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(output_channel_datum),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input, channel_input],
      outputs: [host_output, channel_output],
    }

  let redeemer: HostStateRedeemer =
    HandlePacket {
      channel_siblings,
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: [],
      packet_acknowledgement_siblings: [],
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    host_script_hash,
    host_script_hash,
    channel_script_hash,
    None,
    redeemer,
    host_ref,
    transaction,
  )
}
