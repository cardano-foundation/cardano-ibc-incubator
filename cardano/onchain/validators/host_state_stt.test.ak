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
  // This must match the exact ICS-24 path used by HostState BindPort updates:
  //   ports/{port-id}
  // where `port-id` is the canonical `port-{n}` format from ICS-005.
  let port_id = port_id_keys.format_port_identifier(port)
  key_port_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(port_id)
}

// Generate a deterministic sequence of ports for property-style tests.
//
// We use a fixed range instead of fuzzing because this repository's current
// Aiken version does not expose `aiken/fuzz`. This still gives us broad,
// repeatable coverage across many distinct port values.
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
    // NFT policy that identifies the canonical HostState UTxO.
    nft_policy: PolicyId,
    // Placeholder script hash required by validator parameters in this context.
    dummy_script_hash: ByteArray,
    // HostState script address used by both input and valid output.
    address: Address,
    // Reference of the consumed HostState input.
    input_ref: OutputReference,
    // Fully built HostState input (contains datum + NFT).
    host_input: Input,
    // Port value under test.
    port: Int,
    // Merkle siblings carried in the BindPort redeemer.
    siblings: List<ByteArray>,
    // Expected post-update ibc_state_root for this port and sibling set.
    expected_root: ByteArray,
  }
}

fn mk_bind_port_fixture(port: Int) -> BindPortFixture {
  // Keep all reusable constants centralized so tests only vary one thing: the
  // transition-specific fields they are trying to validate.
  let address = Address(Script(test_dummy_script_hash), None)

  // Baseline HostState before any port is bound.
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

  // Stable input reference keeps this fixture deterministic.
  let input_ref =
    OutputReference {
      transaction_id: test_input_tx_id,
      output_index: 0,
    }

  // Canonical STT input: one HostState NFT + inline HostState datum.
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

  // For an empty root, each witness level is the empty hash.
  let siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  // Compute the only root that should be accepted for this BindPort action.
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
  // The fixture provides the policy context; callers choose the output shape
  // they want to validate (correct or intentionally malformed).
  let BindPortFixture { nft_policy, .. } = fixture

  // This constructor always models the first state transition version (+1 from
  // the fixture input), and callers can override root + bound_port content.
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
  // BindPort redeemer used by all scenarios in this file.
  host_state_stt.BindPort { port: port, port_siblings: port_siblings }
}

fn run_bind_port_with_outputs(
  fixture: BindPortFixture,
  outputs: List<Output>,
  redeemer_siblings: List<ByteArray>,
) -> Bool {
  // This helper runs the actual validator with the given output set and witness.
  // Property tests call this repeatedly across generated ports.
  let BindPortFixture {
    nft_policy,
    dummy_script_hash,
    input_ref,
    host_input,
    port,
    ..
  } = fixture

  let redeemer = mk_bind_port_redeemer(port, redeemer_siblings)

  // Build the minimal transaction shape the HostState STT validator expects:
  // one HostState input and caller-defined outputs.
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
  // Property: for a broad range of ports, a correctly constructed transition
  // should always pass.
  generate_ports(0, 150)
    |> list.all(fn(port) {
      let fixture = mk_bind_port_fixture(port)
      let BindPortFixture { address, expected_root, port, .. } = fixture

      // Correct output uses both:
      // - the exact witness-derived root
      // - the expected bound_port list containing the new port
      let output =
        mk_bind_port_output(fixture, address, expected_root, [port])

      // Keep the same witness used to compute `expected_root`.
      run_bind_port_with_outputs(fixture, [output], fixture.siblings)
    })
}

test prop_host_state_bind_port_rejects_arbitrary_root() {
  // Property: if root does not match the witness-derived update, validation
  // must fail even when other fields look valid.
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

test prop_host_state_bind_port_rejects_missing_bound_port_update() {
  // Property: even with a correct root, the datum must include the newly bound
  // port in the sorted `bound_port` field.
  generate_ports(0, 150)
    |> list.all(fn(port) {
      let fixture = mk_bind_port_fixture(port)
      let BindPortFixture { address, expected_root, .. } = fixture

      // Intentionally omit the new port from `bound_port`.
      let output =
        mk_bind_port_output(fixture, address, expected_root, [])

      // The commitment root is valid, but the state fails to record the newly
      // bound port.
      !run_bind_port_with_outputs(fixture, [output], fixture.siblings)
    })
}

test prop_host_state_bind_port_rejects_non_incremented_version() {
  // Property: version monotonicity is mandatory; root correctness alone is not
  // sufficient for a valid transition.
  generate_ports(0, 150)
    |> list.all(fn(port) {
      let fixture = mk_bind_port_fixture(port)
      let BindPortFixture { nft_policy, address, expected_root, port, .. } = fixture

      // Same root and bound port as a valid transition, but version stays at 0.
      let stale_state =
        HostState {
          version: 0,
          ibc_state_root: expected_root,
          next_client_sequence: 0,
          next_connection_sequence: 0,
          next_channel_sequence: 0,
          bound_port: [port],
          last_update_time: 0,
        }

      let stale_datum =
        HostStateDatum { state: stale_state, nft_policy: nft_policy }

      // Build output manually so the only intended violation is version.
      let output =
        Output {
          address: address,
          value: from_asset(nft_policy, host_state_token_name, 1),
          datum: InlineDatum(stale_datum),
          reference_script: None,
        }

      !run_bind_port_with_outputs(fixture, [output], fixture.siblings)
    })
}
