use aiken/cbor
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction, placeholder}
use ibc/core/ics_005/types/keys as port_id_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{HostState, HostStateDatum, empty_ibc_state_root, host_state_token_name}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use host_state_stt

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

// Generate a deterministic sequence of ports for property-style tests.
fn generate_ports(from: Int, to: Int) -> List<Int> {
  if from > to {
    []
  } else {
    [from, ..generate_ports(from + 1, to)]
  }
}

const test_nft_policy: PolicyId =
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

const test_dummy_script_hash: ByteArray =
  #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"

const test_input_tx_id: ByteArray =
  #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a"

type BindPortFixture {
  BindPortFixture {
    nft_policy: PolicyId,
    dummy_script_hash: ByteArray,
    address: Address,
    input_ref: OutputReference,
    host_input: Input,
    port: Int,
    siblings: List<ByteArray>,
    expected_root: ByteArray,
  }
}

fn mk_bind_port_fixture(port: Int) -> BindPortFixture {
  let address = Address(Script(test_dummy_script_hash), None)

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

  let old_datum =
    HostStateDatum { state: old_state, nft_policy: test_nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: test_input_tx_id,
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: address,
        value: from_asset(test_nft_policy, host_state_token_name, 1),
        datum: InlineDatum(old_datum),
        reference_script: None,
      },
    )

  let siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let expected_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_commitment_key(port),
      "",
      cbor.serialise(port),
      siblings,
    )

  BindPortFixture {
    nft_policy: test_nft_policy,
    dummy_script_hash: test_dummy_script_hash,
    address: address,
    input_ref: input_ref,
    host_input: host_input,
    port: port,
    siblings: siblings,
    expected_root: expected_root,
  }
}

fn mk_bind_port_output(
  fixture: BindPortFixture,
  output_address: Address,
  output_root: ByteArray,
  bound_port: List<Int>,
) -> Output {
  let BindPortFixture { nft_policy, .. } = fixture

  let new_state =
    HostState {
      version: 1,
      ibc_state_root: output_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: bound_port,
      last_update_time: 0,
    }

  let new_datum = HostStateDatum { state: new_state, nft_policy: nft_policy }

  Output {
    address: output_address,
    value: from_asset(nft_policy, host_state_token_name, 1),
    datum: InlineDatum(new_datum),
    reference_script: None,
  }
}

fn mk_bind_port_redeemer(
  port: Int,
  port_siblings: List<ByteArray>,
) -> host_state_stt.HostStateRedeemer {
  host_state_stt.BindPort { port: port, port_siblings: port_siblings }
}

fn run_bind_port_with_outputs(
  fixture: BindPortFixture,
  outputs: List<Output>,
  redeemer_siblings: List<ByteArray>,
) -> Bool {
  let BindPortFixture {
    nft_policy,
    dummy_script_hash,
    input_ref,
    host_input,
    port,
    ..
  } = fixture

  let redeemer = mk_bind_port_redeemer(port, redeemer_siblings)

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: outputs,
    }

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

  let address =
    Address(
      Script(dummy_script_hash),
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

  let old_datum = HostStateDatum { state: old_state, nft_policy: nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: address,
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

  let new_datum = HostStateDatum { state: new_state, nft_policy: nft_policy }

  let host_output =
    Output {
      address: address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // -------------------------------------------------------------------------
  // Act: evaluate the HostState STT validator for BindPort.
  // -------------------------------------------------------------------------
  let redeemer: host_state_stt.HostStateRedeemer =
    host_state_stt.BindPort { port: port, port_siblings: port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
    }

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

  let old_datum = HostStateDatum { state: old_state, nft_policy: nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: address,
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

  let new_datum = HostStateDatum { state: new_state, nft_policy: nft_policy }

  let host_output =
    Output {
      address: address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: host_state_stt.HostStateRedeemer =
    host_state_stt.BindPort { port: port, port_siblings: port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
    }

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

  let original_address =
    Address(
      Script(dummy_script_hash),
      None,
    )

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

  let old_datum = HostStateDatum { state: old_state, nft_policy: nft_policy }

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

  let new_datum = HostStateDatum { state: new_state, nft_policy: nft_policy }

  let host_output =
    Output {
      address: moved_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: host_state_stt.HostStateRedeemer =
    host_state_stt.BindPort { port: port, port_siblings: port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
    }

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

  let old_datum = HostStateDatum { state: old_state, nft_policy: nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: address,
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

  let new_datum = HostStateDatum { state: new_state, nft_policy: nft_policy }

  let host_output =
    Output {
      address: address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // Pass an empty witness list. The validator expects exactly `merkle_depth_bits`
  // hashes, so this must fail.
  let redeemer: host_state_stt.HostStateRedeemer =
    host_state_stt.BindPort { port: port, port_siblings: [] }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
    }

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

  let old_datum = HostStateDatum { state: old_state, nft_policy: nft_policy }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: address,
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

  let redeemer: host_state_stt.HostStateRedeemer =
    host_state_stt.BindPort { port: port, port_siblings: port_siblings }

  // No HostState output is produced, so the STT validator must fail.
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [],
    }

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

test prop_host_state_bind_port_accepts_valid_transition() {
  generate_ports(0, 150)
    |> list.all(fn(port) {
      let fixture = mk_bind_port_fixture(port)
      let BindPortFixture { address, expected_root, port, .. } = fixture

      let output =
        mk_bind_port_output(fixture, address, expected_root, [port])

      run_bind_port_with_outputs(fixture, [output], fixture.siblings)
    })
}

test prop_host_state_bind_port_rejects_arbitrary_root() {
  generate_ports(0, 150)
    |> list.all(fn(port) {
      let fixture = mk_bind_port_fixture(port)
      let BindPortFixture { address, port, .. } = fixture

      // Keep all other fields valid, but set a root that does not match the
      // witness-derived update.
      let output =
        mk_bind_port_output(fixture, address, empty_ibc_state_root, [port])

      !run_bind_port_with_outputs(fixture, [output], fixture.siblings)
    })
}
