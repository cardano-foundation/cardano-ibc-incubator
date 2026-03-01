use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/fuzz
use aiken/primitive/int
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction, placeholder}
use ibc/core/ics_005/types/keys as port_id_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{HostState, HostStateDatum, empty_ibc_state_root, host_state_token_name}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/bits
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

const any_port: Fuzzer<Int> =
  fuzz.int_between(0, 10000)

const small_port_sequence: Fuzzer<List<Int>> =
  fuzz.set_between(any_port, 1, 4)

const medium_port_sequence: Fuzzer<List<Int>> =
  fuzz.set_between(any_port, 2, 4)

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

type PortCommitment {
  PortCommitment {
    key: ByteArray,
    value: ByteArray,
  }
}

type BindPortChainState {
  BindPortChainState {
    host_state: HostState,
    commitments: List<PortCommitment>,
  }
}

fn initial_host_state() -> HostState {
  HostState {
    version: 0,
    ibc_state_root: empty_ibc_state_root,
    next_client_sequence: 0,
    next_connection_sequence: 0,
    next_channel_sequence: 0,
    bound_port: [],
    last_update_time: 0,
  }
}

fn initial_bind_port_chain_state() -> BindPortChainState {
  BindPortChainState {
    host_state: initial_host_state(),
    commitments: [],
  }
}

fn key_bit_at_depth(key: ByteArray, depth: Int) -> Int {
  let key_hash = builtin.sha2_256(key)
  // `ibc_state_commitment.compute_root` consumes sibling bits from leaf to root
  // (depth 0 is the first step above the leaf). Our test-side sparse tree
  // descends from root to leaf, so we read bits in reverse order.
  let bit_index = ibc_state_commitment.merkle_depth_bits - 1 - depth
  let byte_index = 7 - (bit_index / 8)
  let bit_in_byte = bit_index % 8
  let byte = builtin.index_bytearray(key_hash, byte_index)
  bits.shr(byte, bit_in_byte) % 2
}

fn split_commitments_by_bit(
  commitments: List<PortCommitment>,
  depth: Int,
) -> (List<PortCommitment>, List<PortCommitment>) {
  list.partition(
    commitments,
    fn(commitment) {
      let PortCommitment { key, .. } = commitment
      key_bit_at_depth(key, depth) == 0
    },
  )
}

fn subtree_root_from_commitments(
  commitments: List<PortCommitment>,
  depth: Int,
) -> ByteArray {
  // Short-circuit empty subtrees to avoid expanding all 2^depth branches of
  // the sparse tree during test-side witness/root reconstruction.
  if commitments == [] {
    ibc_state_commitment.empty_hash
  } else if depth == ibc_state_commitment.merkle_depth_bits {
    when commitments is {
      [] ->
        ibc_state_commitment.empty_hash
      [PortCommitment { value, .. }, ..] ->
        value |> ibc_state_commitment.value_hash() |> ibc_state_commitment.leaf_hash()
    }
  } else {
    let (left, right) = split_commitments_by_bit(commitments, depth)
    let left_root = subtree_root_from_commitments(left, depth + 1)
    let right_root = subtree_root_from_commitments(right, depth + 1)
    ibc_state_commitment.inner_hash(left_root, right_root)
  }
}

fn siblings_for_key(commitments: List<PortCommitment>, key: ByteArray) -> List<ByteArray> {
  siblings_for_key_go(commitments, key, 0) |> list.reverse
}

fn siblings_for_key_go(
  commitments: List<PortCommitment>,
  key: ByteArray,
  depth: Int,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    let bit = key_bit_at_depth(key, depth)
    let (left, right) = split_commitments_by_bit(commitments, depth)

    if bit == 0 {
      let sibling_root = subtree_root_from_commitments(right, depth + 1)
      [sibling_root, ..siblings_for_key_go(left, key, depth + 1)]
    } else {
      let sibling_root = subtree_root_from_commitments(left, depth + 1)
      [sibling_root, ..siblings_for_key_go(right, key, depth + 1)]
    }
  }
}

fn run_bind_port_transition(
  old_state: HostState,
  new_state: HostState,
  port: Int,
  port_siblings: List<ByteArray>,
) -> Bool {
  let address = Address(Script(test_dummy_script_hash), None)

  let input_ref =
    OutputReference {
      transaction_id: test_input_tx_id,
      output_index: 0,
    }

  let old_datum =
    HostStateDatum { state: old_state, nft_policy: test_nft_policy }
  let new_datum =
    HostStateDatum { state: new_state, nft_policy: test_nft_policy }

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

  let host_output =
    Output {
      address: address,
      value: from_asset(test_nft_policy, host_state_token_name, 1),
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
    test_nft_policy,
    test_dummy_script_hash,
    test_dummy_script_hash,
    test_dummy_script_hash,
    None,
    redeemer,
    input_ref,
    transaction,
  )
}

fn apply_bind_port_step(
  chain_state: BindPortChainState,
  port: Int,
) -> Option<BindPortChainState> {
  let BindPortChainState {
    host_state: old_state,
    commitments: old_commitments,
  } = chain_state

  let key = port_commitment_key(port)
  let value = cbor.serialise(port)
  let port_siblings = siblings_for_key(old_commitments, key)

  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      key,
      "",
      value,
      port_siblings,
    )

  let new_state =
    HostState {
      version: old_state.version + 1,
      ibc_state_root: new_root,
      next_client_sequence: old_state.next_client_sequence,
      next_connection_sequence: old_state.next_connection_sequence,
      next_channel_sequence: old_state.next_channel_sequence,
      bound_port: list.push(old_state.bound_port, port) |> list.sort(int.compare),
      last_update_time: old_state.last_update_time,
    }

  if run_bind_port_transition(old_state, new_state, port, port_siblings) {
    Some(
      BindPortChainState {
        host_state: new_state,
        commitments: [PortCommitment { key: key, value: value }, ..old_commitments],
      },
    )
  } else {
    None
  }
}

fn apply_bind_port_sequence(
  chain_state: BindPortChainState,
  ports: List<Int>,
) -> Option<BindPortChainState> {
  when ports is {
    [] ->
      Some(chain_state)
    [port, ..rest] ->
      when apply_bind_port_step(chain_state, port) is {
        Some(next_state) -> apply_bind_port_sequence(next_state, rest)
        None -> None
      }
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

test prop_host_state_bind_port_accepts_valid_transition(port via any_port) {
  // Property: for any sampled non-negative port, a correctly constructed
  // transition should pass.
  let fixture = mk_bind_port_fixture(port)
  let BindPortFixture { address, expected_root, .. } = fixture

  // Correct output uses both:
  // - the exact witness-derived root
  // - the expected bound_port list containing the new port
  let output =
    mk_bind_port_output(fixture, address, expected_root, [port])

  // Keep the same witness used to compute `expected_root`.
  run_bind_port_with_outputs(fixture, [output], fixture.siblings)
}

test prop_host_state_bind_port_rejects_arbitrary_root(port via any_port) {
  // Property: if root does not match the witness-derived update, validation
  // must fail even when other fields look valid.
  let fixture = mk_bind_port_fixture(port)
  let BindPortFixture { address, .. } = fixture

  // Keep all other fields valid, but set a root that does not match the
  // witness-derived update.
  let output =
    mk_bind_port_output(fixture, address, empty_ibc_state_root, [port])

  !run_bind_port_with_outputs(fixture, [output], fixture.siblings)
}

test prop_host_state_bind_port_rejects_missing_bound_port_update(port via any_port) {
  // Property: even with a correct root, the datum must include the newly bound
  // port in the sorted `bound_port` field.
  let fixture = mk_bind_port_fixture(port)
  let BindPortFixture { address, expected_root, .. } = fixture

  // Intentionally omit the new port from `bound_port`.
  let output =
    mk_bind_port_output(fixture, address, expected_root, [])

  // The commitment root is valid, but the state fails to record the newly
  // bound port.
  !run_bind_port_with_outputs(fixture, [output], fixture.siblings)
}

test prop_host_state_bind_port_rejects_non_incremented_version(port via any_port) {
  // Property: version monotonicity is mandatory; root correctness alone is not
  // sufficient for a valid transition.
  let fixture = mk_bind_port_fixture(port)
  let BindPortFixture { nft_policy, address, expected_root, .. } = fixture

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
}

test prop_host_state_bind_port_sequence_preserves_invariants(
  ports via small_port_sequence,
) {
  // Property: when we apply multiple valid BindPort transitions in sequence,
  // we preserve the expected global HostState invariants.
  expect Some(final_state) =
    apply_bind_port_sequence(initial_bind_port_chain_state(), ports)

  let BindPortChainState { host_state, commitments } = final_state
  let expected_bound_ports = ports |> list.sort(int.compare)

  and {
    host_state.version == list.length(ports),
    host_state.bound_port == expected_bound_ports,
    host_state.ibc_state_root == subtree_root_from_commitments(commitments, 0),
  }
}

test prop_host_state_bind_port_sequence_root_is_order_independent(
  ports via medium_port_sequence,
) {
  // Property: for distinct ports, final root should not depend on insertion
  // order as long as every step carries a correct witness for the current state.
  expect Some(forward_state) =
    apply_bind_port_sequence(initial_bind_port_chain_state(), ports)
  expect Some(reverse_state) =
    apply_bind_port_sequence(
      initial_bind_port_chain_state(),
      ports |> list.reverse,
    )

  let BindPortChainState { host_state: forward_host_state, .. } = forward_state
  let BindPortChainState { host_state: reverse_host_state, .. } = reverse_state

  and {
    forward_host_state.ibc_state_root == reverse_host_state.ibc_state_root,
    forward_host_state.bound_port == reverse_host_state.bound_port,
  }
}

test prop_host_state_bind_port_replay_attempt_fails(port via any_port) fail {
  // Property: replaying BindPort for a port that is already bound must fail.
  expect Some(after_first_bind) =
    apply_bind_port_step(initial_bind_port_chain_state(), port)

  let BindPortChainState { host_state: old_state, commitments } = after_first_bind
  let key = port_commitment_key(port)
  let replay_siblings = siblings_for_key(commitments, key)

  // Keep root and bound_port unchanged and only bump version. Replaying the
  // same BindPort operation should still be rejected.
  let replay_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
    }

  run_bind_port_transition(old_state, replay_state, port, replay_siblings)
}
