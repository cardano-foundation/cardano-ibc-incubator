use aiken/cbor
use aiken/collection/list
use aiken/crypto
use aiken/fuzz
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use host_state_stt
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational.{
  UncheckedRational,
}
use ibc/core/ics_002_client_semantics/types/keys as client_id_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty as connection_counterparty
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelDatumState, max_packet_entries_per_channel,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order as channel_order
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/keys as port_id_keys
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/channel_keys as host_channel_keys
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_024_host_requirements/port_keys.{key_port_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, ModuleRegistration, ShutdownState,
  ShuttingDown, empty_ibc_state_root, host_state_token_name, max_bound_ports,
  max_port_number, validate_bind_port,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, EnterShutdown, FinalizeShutdown, HandlePacket, Heartbeat,
  HostStateRedeemer, UpdateChannel, UpdateClient, UpdateConnection,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/testing/fuzz_dsl

// Build a list with `count` copies of `value`.
fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn packet_entries(
  sequence: Int,
  last_sequence: Int,
  value: ByteArray,
) -> Pairs<Int, ByteArray> {
  if sequence > last_sequence {
    []
  } else {
    [
      Pair(sequence, value),
      ..packet_entries(sequence + 1, last_sequence, value)
    ]
  }
}

fn port_commitment_key(port: Int) -> ByteArray {
  let port_id = port_id_keys.format_port_identifier(port)
  key_port_prefix
    |> bytearray.concat("/")
    |> bytearray.concat(port_id)
}

fn test_module_registration(
  module_script_hash: crypto.Hash<crypto.Blake2b_224, crypto.Script>,
) -> ModuleRegistration {
  ModuleRegistration {
    module_script_hash,
    port_token: AuthToken { policy_id: "mock port policy", name: "mock port" },
    module_token: AuthToken {
      policy_id: "mock module policy",
      name: "mock module",
    },
  }
}

fn test_module_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"915f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b379"
}

fn test_module_output(registration: ModuleRegistration) -> Output {
  Output {
    address: Address(Script(registration.module_script_hash), None),
    value: from_asset(
      registration.port_token.policy_id,
      registration.port_token.name,
      1,
    )
      |> add(
          registration.module_token.policy_id,
          registration.module_token.name,
          1,
        ),
    datum: NoDatum,
    reference_script: None,
  }
}

test module_registration_cbor_matches_offchain_codec() {
  let registration =
    ModuleRegistration {
      module_script_hash: #"11111111111111111111111111111111111111111111111111111111",
      port_token: AuthToken {
        policy_id: #"22222222222222222222222222222222222222222222222222222222",
        name: #"01",
      },
      module_token: AuthToken {
        policy_id: #"33333333333333333333333333333333333333333333333333333333",
        name: #"02",
      },
    }

  cbor.serialise(registration) == #"d8799f581c11111111111111111111111111111111111111111111111111111111d8799f581c222222222222222222222222222222222222222222222222222222224101ffd8799f581c333333333333333333333333333333333333333333333333333333334102ffff"
}

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

fn test_host_state_datum(
  state: HostState,
  nft_policy: PolicyId,
) -> HostStateDatum {
  HostStateDatum {
    state,
    nft_policy,
    deployer: trusted_deployer,
    shutdown: Active,
  }
}

fn test_host_state_datum_with_shutdown(
  state: HostState,
  nft_policy: PolicyId,
  shutdown: ShutdownState,
) -> HostStateDatum {
  HostStateDatum { state, nft_policy, deployer: trusted_deployer, shutdown }
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

fn positive_seed(seed: Int) -> Int {
  if seed < 0 {
    -seed
  } else {
    seed
  }
}

fn test_sequence(seed: Int) -> Int {
  positive_seed(seed % 30) + 1
}

fn full_empty_siblings() -> List<ByteArray> {
  repeat_bytearray(
    ibc_state_commitment.empty_hash,
    ibc_state_commitment.merkle_depth_bits,
  )
}

fn test_nft_policy() -> PolicyId {
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
}

fn test_host_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
}

fn test_client_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"c15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b373"
}

fn test_connection_script_hash() -> crypto.Hash<
  crypto.Blake2b_224,
  crypto.Script,
> {
  #"b15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
}

fn test_channel_script_hash() -> crypto.Hash<crypto.Blake2b_224, crypto.Script> {
  #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
}

fn test_host_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: 0,
  }
}

fn test_object_ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
    output_index: index,
  }
}

fn test_host_state(root: ByteArray, seed: Int) -> HostState {
  let version = positive_seed(seed % 50)
  HostState {
    version,
    ibc_state_root: root,
    next_client_sequence: 0,
    next_connection_sequence: 0,
    next_channel_sequence: 0,
    bound_port: [],
    last_update_time: positive_seed(seed),
  }
}

fn test_bound_ports(ports: List<Int>) -> Pairs<Int, ModuleRegistration> {
  when ports is {
    [] -> []
    [port, ..rest] ->
      [
        Pair(port, test_module_registration(test_module_script_hash())),
        ..test_bound_ports(rest)
      ]
  }
}

fn test_bind_port_transition(
  old_ports: List<Int>,
  new_ports: List<Int>,
  port: Int,
) -> Bool {
  let nft_policy = test_nft_policy()
  let registration = test_module_registration(test_module_script_hash())
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      bound_port: test_bound_ports(old_ports),
    }
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      bound_port: test_bound_ports(new_ports),
    }
  validate_bind_port(
    test_host_state_datum(old_state, nft_policy),
    test_host_state_datum(new_state, nft_policy),
    port,
    registration,
  )
}

fn test_host_input(state: HostState) -> Input {
  let nft_policy = test_nft_policy()
  Input(
    test_host_ref(),
    Output {
      address: Address(Script(test_host_script_hash()), None),
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(test_host_state_datum(state, nft_policy)),
      reference_script: None,
    },
  )
}

fn test_host_output(state: HostState) -> Output {
  let nft_policy = test_nft_policy()
  Output {
    address: Address(Script(test_host_script_hash()), None),
    value: from_asset(nft_policy, host_state_token_name, 1),
    datum: InlineDatum(test_host_state_datum(state, nft_policy)),
    reference_script: None,
  }
}

fn test_unrelated_outputs(count: Int) -> List<Output> {
  list.repeat(
    test_module_output(test_module_registration(test_module_script_hash())),
    count,
  )
}

fn spend_host_state(
  redeemer: HostStateRedeemer,
  inputs: List<Input>,
  outputs: List<Output>,
) -> Bool {
  spend_host_state_with_signatories(redeemer, inputs, outputs, [])
}

fn spend_host_state_with_signatories(
  redeemer: HostStateRedeemer,
  inputs: List<Input>,
  outputs: List<Output>,
  extra_signatories: List<crypto.VerificationKeyHash>,
) -> Bool {
  host_state_stt.host_state_stt.spend(
    test_nft_policy(),
    test_client_script_hash(),
    test_connection_script_hash(),
    test_channel_script_hash(),
    None,
    redeemer,
    test_host_ref(),
    Transaction { ..placeholder, inputs, outputs, extra_signatories },
  )
}

fn spend_test_bind_port(
  old_ports: List<Int>,
  new_ports: List<Int>,
  port: Int,
  extra_signatories: List<crypto.VerificationKeyHash>,
) -> Bool {
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )
  let old_state =
    HostState {
      ..test_host_state(empty_ibc_state_root, 0),
      bound_port: test_bound_ports(old_ports),
    }
  let new_root =
    ibc_state_commitment.apply_update(
      old_state.ibc_state_root,
      port_commitment_key(port),
      "",
      cbor.serialise(registration),
      port_siblings,
    )
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
      bound_port: test_bound_ports(new_ports),
    }

  spend_host_state_with_signatories(
    BindPort { port, registration, port_siblings },
    [test_host_input(old_state)],
    [test_host_output(new_state), test_module_output(registration)],
    extra_signatories,
  )
}

fn test_client_token() -> AuthToken {
  let base_token =
    AuthToken { policy_id: "mock base token policy", name: "mock base token" }
  AuthToken {
    policy_id: "mock client policy",
    name: auth.generate_token_name(
      base_token,
      client_id_keys.client_prefix,
      "0",
    ),
  }
}

fn test_height(revision_height: Int) -> Height {
  Height { revision_number: 0, revision_height }
}

fn test_consensus_state(seed: Int) -> ConsensusState {
  ConsensusState {
    timestamp: positive_seed(seed) + 1,
    next_validators_hash: #"010203",
    root: MerkleRoot { hash: #"040506" },
  }
}

fn test_client_state(latest_height: Height) -> ClientState {
  ClientState {
    chain_id: "chain-0",
    trust_level: UncheckedRational { numerator: 1, denominator: 3 },
    trusting_period: 1000,
    unbonding_period: 2000,
    max_clock_drift: 10,
    frozen_height: test_height(0),
    latest_height,
    proof_specs: [],
  }
}

fn test_client_datum(latest_height: Int, seed: Int) -> ClientDatum {
  let height = test_height(latest_height)
  ClientDatum {
    state: ClientDatumState {
      client_state: test_client_state(height),
      consensus_states: [Pair(height, test_consensus_state(seed))],
      processed_times: [Pair(height, 0)],
      processed_heights: [Pair(height, 0)],
    },
    token: test_client_token(),
  }
}

fn test_updated_client_datum(seed: Int) -> ClientDatum {
  let old_height = test_height(1)
  let new_height = test_height(2)
  ClientDatum {
    state: ClientDatumState {
      client_state: test_client_state(new_height),
      consensus_states: [Pair(old_height, test_consensus_state(seed))],
      processed_times: [Pair(old_height, 0)],
      processed_heights: [Pair(old_height, 0)],
    },
    token: test_client_token(),
  }
}

fn test_client_input(datum: ClientDatum) -> Input {
  let token = test_client_token()
  Input(
    test_object_ref(1),
    Output {
      address: Address(Script(test_client_script_hash()), None),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn test_client_output(datum: ClientDatum) -> Output {
  let token = test_client_token()
  Output {
    address: Address(Script(test_client_script_hash()), None),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn test_update_client_root(
  old_root: ByteArray,
  input_datum: ClientDatum,
  output_datum: ClientDatum,
  client_state_siblings: List<ByteArray>,
) -> ByteArray {
  let client_state_key = client_keys.full_client_state_path("07-tendermint-0")
  ibc_state_commitment.apply_update(
    old_root,
    client_state_key,
    cbor.serialise(input_datum.state.client_state),
    cbor.serialise(output_datum.state.client_state),
    client_state_siblings,
  )
}

fn test_committed_client_root(
  input_datum: ClientDatum,
  client_state_siblings: List<ByteArray>,
) -> ByteArray {
  let client_state_key = client_keys.full_client_state_path("07-tendermint-0")
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    client_state_key,
    "",
    cbor.serialise(input_datum.state.client_state),
    client_state_siblings,
  )
}

fn test_connection_token() -> AuthToken {
  let base_token =
    AuthToken { policy_id: "mock base token policy", name: "mock base token" }
  AuthToken {
    policy_id: "mock connection policy",
    name: auth.generate_token_name(
      base_token,
      connection_keys.connection_prefix,
      "0",
    ),
  }
}

fn test_connection_end(
  state: connection_state.State,
  seed: Int,
) -> ConnectionEnd {
  ConnectionEnd {
    client_id: "07-tendermint-0",
    versions: [Version { identifier: "1", features: ["ORDER_UNORDERED"] }],
    state,
    counterparty: connection_counterparty.Counterparty {
      client_id: "07-tendermint-1",
      connection_id: if state == connection_state.Init {
        ""
      } else {
        "connection-1"
      },
      prefix: MerklePrefix { key_prefix: "ibc" },
    },
    delay_period: positive_seed(seed % 10),
  }
}

fn test_connection_datum(
  state: connection_state.State,
  seed: Int,
) -> ConnectionDatum {
  ConnectionDatum {
    state: test_connection_end(state, seed),
    token: test_connection_token(),
  }
}

fn test_connection_input(datum: ConnectionDatum) -> Input {
  let token = test_connection_token()
  Input(
    test_object_ref(2),
    Output {
      address: Address(Script(test_connection_script_hash()), None),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn test_connection_output(datum: ConnectionDatum) -> Output {
  let token = test_connection_token()
  Output {
    address: Address(Script(test_connection_script_hash()), None),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn test_update_connection_root(
  old_root: ByteArray,
  input_datum: ConnectionDatum,
  output_datum: ConnectionDatum,
  connection_siblings: List<ByteArray>,
) -> ByteArray {
  let connection_key = host_connection_keys.connection_path("connection-0")
  ibc_state_commitment.apply_update(
    old_root,
    connection_key,
    cbor.serialise(input_datum.state),
    cbor.serialise(output_datum.state),
    connection_siblings,
  )
}

fn test_committed_connection_root(
  input_datum: ConnectionDatum,
  connection_siblings: List<ByteArray>,
) -> ByteArray {
  let connection_key = host_connection_keys.connection_path("connection-0")
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    connection_key,
    "",
    cbor.serialise(input_datum.state),
    connection_siblings,
  )
}

fn test_channel_datum_full(
  channel: Channel,
  next_sequence_send: Int,
  next_sequence_recv: Int,
  next_sequence_ack: Int,
  packet_commitment: Pairs<Int, ByteArray>,
  packet_receipt: Pairs<Int, ByteArray>,
  packet_acknowledgement: Pairs<Int, ByteArray>,
) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel,
      next_sequence_send,
      next_sequence_recv,
      next_sequence_ack,
      packet_commitment,
      packet_receipt,
      packet_acknowledgement,
    },
    port_id: "transfer",
    token: test_channel_token(),
  }
}

fn test_channel_input_full(datum: ChannelDatum) -> Input {
  let token = test_channel_token()
  Input(
    test_object_ref(3),
    Output {
      address: Address(Script(test_channel_script_hash()), None),
      value: from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  )
}

fn test_channel_output_full(datum: ChannelDatum) -> Output {
  let token = test_channel_token()
  Output {
    address: Address(Script(test_channel_script_hash()), None),
    value: from_asset(token.policy_id, token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn channel_path() -> ByteArray {
  host_channel_keys.channel_path("transfer", "channel-0")
}

fn test_update_channel_root(
  old_root: ByteArray,
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  channel_siblings: List<ByteArray>,
) -> ByteArray {
  ibc_state_commitment.apply_update(
    old_root,
    channel_path(),
    cbor.serialise(input_datum.state.channel),
    cbor.serialise(output_datum.state.channel),
    channel_siblings,
  )
}

fn test_committed_channel_root(
  input_datum: ChannelDatum,
  channel_siblings: List<ByteArray>,
) -> ByteArray {
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    channel_path(),
    "",
    cbor.serialise(input_datum.state.channel),
    channel_siblings,
  )
}

fn test_committed_packet_root(
  sequence: Int,
  commitment: ByteArray,
  packet_commitment_siblings: List<ByteArray>,
) -> ByteArray {
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    empty_ibc_state_root,
    commitment_key,
    "",
    cbor.serialise(commitment),
    packet_commitment_siblings,
  )
}

fn handle_packet_redeemer(
  channel_siblings: List<ByteArray>,
  next_sequence_send_siblings: List<ByteArray>,
  next_sequence_recv_siblings: List<ByteArray>,
  next_sequence_ack_siblings: List<ByteArray>,
  packet_commitment_siblings: List<ByteArray>,
  packet_receipt_siblings: List<ByteArray>,
  packet_acknowledgement_siblings: List<ByteArray>,
) -> HostStateRedeemer {
  HandlePacket {
    channel_siblings,
    next_sequence_send_siblings,
    next_sequence_recv_siblings,
    next_sequence_ack_siblings,
    packet_commitment_siblings,
    packet_receipt_siblings,
    packet_acknowledgement_siblings,
  }
}

fn test_handle_packet_send_root(
  old_root: ByteArray,
  sequence: Int,
  commitment: ByteArray,
  next_sequence_send_siblings: List<ByteArray>,
  packet_commitment_siblings: List<ByteArray>,
) -> ByteArray {
  let next_sequence_send_key =
    packet_keys.next_sequence_send_path("transfer", "channel-0")
  let root_after_sequence =
    ibc_state_commitment.apply_update(
      old_root,
      next_sequence_send_key,
      cbor.serialise(sequence),
      cbor.serialise(sequence + 1),
      next_sequence_send_siblings,
    )
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    root_after_sequence,
    commitment_key,
    "",
    cbor.serialise(commitment),
    packet_commitment_siblings,
  )
}

fn test_handle_packet_receipt_root(
  old_root: ByteArray,
  sequence: Int,
  packet_receipt_siblings: List<ByteArray>,
) -> ByteArray {
  let receipt_key =
    packet_keys.packet_receipt_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    old_root,
    receipt_key,
    "",
    cbor.serialise(""),
    packet_receipt_siblings,
  )
}

fn test_handle_packet_acknowledgement_root(
  old_root: ByteArray,
  sequence: Int,
  acknowledgement: ByteArray,
  packet_acknowledgement_siblings: List<ByteArray>,
) -> ByteArray {
  let acknowledgement_key =
    packet_keys.packet_acknowledgement_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    old_root,
    acknowledgement_key,
    "",
    cbor.serialise(acknowledgement),
    packet_acknowledgement_siblings,
  )
}

fn test_handle_packet_commitment_delete_root(
  old_root: ByteArray,
  sequence: Int,
  commitment: ByteArray,
  packet_commitment_siblings: List<ByteArray>,
) -> ByteArray {
  let commitment_key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  ibc_state_commitment.apply_update(
    old_root,
    commitment_key,
    cbor.serialise(commitment),
    "",
    packet_commitment_siblings,
  )
}

test prop_host_update_client_accepts_exact_root(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.update_client.valid")

  // Positive root-transition case: the client datum change is committed into
  // the new HostState root with the same siblings supplied to the redeemer.
  let siblings = full_empty_siblings()
  let input_client_datum = test_client_datum(1, seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let new_root =
    test_update_client_root(
      old_root,
      input_client_datum,
      output_client_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateClient {
      client_state_siblings: siblings,
      consensus_state_siblings: siblings,
      removed_consensus_state_siblings: [],
    }

  fuzz_dsl.valid_check(
    "host",
    "update_client",
    "spend_host_state",
    spend_host_state(
      redeemer,
      [test_host_input(old_state), test_client_input(input_client_datum)],
      [test_host_output(new_state), test_client_output(output_client_datum)],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_update_client_rejects_wrong_root(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.update_client.invalid_wrong_root")

  // Near-valid mutation: the client datum changes, but HostState keeps the old
  // root. This proves object UTxOs cannot move without a matching root update.
  let siblings = full_empty_siblings()
  let input_client_datum = test_client_datum(1, seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateClient {
      client_state_siblings: siblings,
      consensus_state_siblings: siblings,
      removed_consensus_state_siblings: [],
    }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_client_input(input_client_datum)],
    [test_host_output(new_state), test_client_output(output_client_datum)],
  )
}

test prop_host_update_client_rejects_wrong_redeemer(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.update_client.invalid_wrong_redeemer")

  // The root is correct for a client update, but the redeemer claims a
  // connection update. HostState must bind each state mutation to its operation.
  let siblings = full_empty_siblings()
  let input_client_datum = test_client_datum(1, seed)
  let output_client_datum = test_updated_client_datum(seed)
  let old_root = test_committed_client_root(input_client_datum, siblings)
  let new_root =
    test_update_client_root(
      old_root,
      input_client_datum,
      output_client_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_client_input(input_client_datum)],
    [test_host_output(new_state), test_client_output(output_client_datum)],
  )
}

test prop_host_update_connection_accepts_exact_root(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.update_connection.valid")

  let siblings = full_empty_siblings()
  let input_connection_datum =
    test_connection_datum(connection_state.Init, seed)
  let output_connection_datum =
    test_connection_datum(connection_state.Open, seed)
  let old_root =
    test_committed_connection_root(input_connection_datum, siblings)
  let new_root =
    test_update_connection_root(
      old_root,
      input_connection_datum,
      output_connection_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }

  fuzz_dsl.valid_check(
    "host",
    "update_connection",
    "spend_host_state",
    spend_host_state(
      redeemer,
      [
        test_host_input(old_state),
        test_connection_input(input_connection_datum),
      ],
      [
        test_host_output(new_state),
        test_connection_output(output_connection_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_update_connection_rejects_uncommitted_change(
  seed via fuzz.int(),
) fail {
  fuzz.label(
    @"fuzz.contract.host.update_connection.invalid_uncommitted_connection_change",
  )

  // The connection datum advances from Init to Open while the root is left
  // unchanged. That is exactly the uncommitted-state mutation HostState guards.
  let siblings = full_empty_siblings()
  let input_connection_datum =
    test_connection_datum(connection_state.Init, seed)
  let output_connection_datum =
    test_connection_datum(connection_state.Open, seed)
  let old_root =
    test_committed_connection_root(input_connection_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }
  let redeemer: HostStateRedeemer =
    UpdateConnection { connection_siblings: siblings }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_connection_input(input_connection_datum)],
    [
      test_host_output(new_state),
      test_connection_output(output_connection_datum),
    ],
  )
}

test prop_host_update_channel_accepts_exact_root(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.update_channel.valid")

  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Init), 1, [])
  let output_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let new_root =
    test_update_channel_root(
      old_root,
      input_channel_datum,
      output_channel_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }
  let redeemer: HostStateRedeemer = UpdateChannel { channel_siblings: siblings }

  fuzz_dsl.valid_check(
    "host",
    "update_channel",
    "spend_host_state",
    spend_host_state(
      redeemer,
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_update_channel_rejects_packet_field_change(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.update_channel.invalid_packet_field_change")

  // UpdateChannel may change channel state, but packet fields are owned by
  // HandlePacket. Mutating sequence/commitment here must be rejected.
  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let output_channel_datum =
    test_channel_datum(
      test_channel(channel_state.Open),
      2,
      [Pair(1, #"010203")],
    )
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: old_root,
    }
  let redeemer: HostStateRedeemer = UpdateChannel { channel_siblings: siblings }

  spend_host_state(
    redeemer,
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_accepts_send(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_send")

  // SendPacket creates a packet commitment, so the new root must commit exactly
  // that packet key/value and the channel datum must record the same sequence.
  let sequence = test_sequence(seed)
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let commitment = #"010203"
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let new_root = test_committed_packet_root(sequence, commitment, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_send",
    "spend_host_state",
    spend_host_state(
      handle_packet_redeemer([], [], [], [], siblings, [], []),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_handle_packet_accepts_recv(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_recv")

  let sequence = test_sequence(seed)
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [Pair(sequence, "")],
      [],
    )
  let new_root = test_handle_packet_receipt_root(old_root, sequence, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_recv",
    "spend_host_state",
    spend_host_state(
      handle_packet_redeemer([], [], [], [], [], siblings, []),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test host_state_handle_packet_recv_succeeds_at_history_capacity() {
  let sequence = max_packet_entries_per_channel
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, sequence - 1, "")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [Pair(sequence, ""), ..existing_receipts],
      [],
    )
  let new_root = test_handle_packet_receipt_root(old_root, sequence, siblings)
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer([], [], [], [], [], siblings, []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_history_capacity_overflow(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_history_capacity")

  let half_capacity = max_packet_entries_per_channel / 2
  let sequence = half_capacity + 1
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, half_capacity, "")
  let existing_acknowledgements =
    packet_entries(1, half_capacity, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [Pair(sequence, ""), ..existing_receipts],
      existing_acknowledgements,
    )
  let new_root = test_handle_packet_receipt_root(old_root, sequence, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer([], [], [], [], [], siblings, []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test host_state_handle_packet_acknowledgement_succeeds_at_history_capacity() {
  let sequence = max_packet_entries_per_channel
  let acknowledgement = "new acknowledgement"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_acknowledgements =
    packet_entries(1, sequence - 1, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [Pair(sequence, acknowledgement), ..existing_acknowledgements],
    )
  let new_root =
    test_handle_packet_acknowledgement_root(
      old_root,
      sequence,
      acknowledgement,
      siblings,
    )
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer([], [], [], [], [], [], siblings),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_acknowledgement_capacity_overflow(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_ack_capacity")

  let half_capacity = max_packet_entries_per_channel / 2
  let sequence = half_capacity + 1
  let acknowledgement = "new acknowledgement"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, half_capacity, "")
  let existing_acknowledgements =
    packet_entries(1, half_capacity, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      [Pair(sequence, acknowledgement), ..existing_acknowledgements],
    )
  let new_root =
    test_handle_packet_acknowledgement_root(
      old_root,
      sequence,
      acknowledgement,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer([], [], [], [], [], [], siblings),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test host_state_handle_packet_send_succeeds_at_commitment_capacity() {
  let sequence = max_packet_entries_per_channel
  let commitment = "new commitment"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_commitments =
    packet_entries(1, sequence - 1, "existing commitment")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      existing_commitments,
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [Pair(sequence, commitment), ..existing_commitments],
      [],
      [],
    )
  let new_root = test_committed_packet_root(sequence, commitment, siblings)
  let old_state = test_host_state(old_root, 0)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer([], [], [], [], siblings, [], []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_commitment_capacity_overflow(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_commitment_capacity")

  let half_capacity = max_packet_entries_per_channel / 2
  let sequence = half_capacity + 1
  let commitment = "new commitment"
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let existing_receipts = packet_entries(1, half_capacity, "")
  let existing_acknowledgements =
    packet_entries(1, half_capacity, "existing acknowledgement")
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      existing_receipts,
      existing_acknowledgements,
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [Pair(sequence, commitment)],
      existing_receipts,
      existing_acknowledgements,
    )
  let new_root = test_committed_packet_root(sequence, commitment, siblings)
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer([], [], [], [], siblings, [], []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_accepts_ack(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_ack")

  let sequence = test_sequence(seed)
  let siblings = full_empty_siblings()
  let commitment = #"010203"
  let old_root = test_committed_packet_root(sequence, commitment, siblings)
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let new_root =
    test_handle_packet_commitment_delete_root(
      old_root,
      sequence,
      commitment,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_ack",
    "spend_host_state",
    spend_host_state(
      handle_packet_redeemer([], [], [], [], siblings, [], []),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_handle_packet_accepts_timeout(seed via fuzz.int()) {
  fuzz.label(@"fuzz.contract.host.handle_packet.valid_timeout")

  let sequence = test_sequence(seed)
  let siblings = full_empty_siblings()
  let commitment = "timeout-commitment"
  let old_root = test_committed_packet_root(sequence, commitment, siblings)
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      1,
      1,
      1,
      [],
      [],
      [],
    )
  let new_root =
    test_handle_packet_commitment_delete_root(
      old_root,
      sequence,
      commitment,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  fuzz_dsl.valid_check(
    "host",
    "handle_packet_timeout",
    "spend_host_state",
    spend_host_state(
      handle_packet_redeemer([], [], [], [], siblings, [], []),
      [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
      [
        test_host_output(new_state),
        test_channel_output_full(output_channel_datum),
      ],
    ),
  )
    |> fuzz_dsl.assert_valid
}

test prop_host_handle_packet_rejects_channel_only_change(
  seed via fuzz.int(),
) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_channel_only_change")

  // HandlePacket cannot be used as a generic channel-state updater. Closing the
  // channel with packet redeemer shape should fail even with a consistent root.
  let siblings = full_empty_siblings()
  let input_channel_datum =
    test_channel_datum(test_channel(channel_state.Open), 1, [])
  let output_channel_datum =
    test_channel_datum(test_channel(channel_state.Closed), 1, [])
  let old_root = test_committed_channel_root(input_channel_datum, siblings)
  let new_root =
    test_update_channel_root(
      old_root,
      input_channel_datum,
      output_channel_datum,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: new_root,
    }

  spend_host_state(
    handle_packet_redeemer(siblings, [], [], [], [], [], []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_handle_packet_rejects_wrong_packet_key(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.handle_packet.invalid_wrong_packet_key")

  // The channel datum records the expected commitment, but the HostState root is
  // built for a different packet key. This catches key/path drift in packets.
  let sequence = test_sequence(seed)
  let siblings = full_empty_siblings()
  let old_root = empty_ibc_state_root
  let commitment = #"010203"
  let input_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [],
      [],
      [],
    )
  let output_channel_datum =
    test_channel_datum_full(
      test_channel(channel_state.Open),
      sequence,
      1,
      1,
      [Pair(sequence, commitment)],
      [],
      [],
    )
  let wrong_root =
    test_handle_packet_send_root(
      old_root,
      sequence + 1,
      commitment,
      siblings,
      siblings,
    )
  let old_state = test_host_state(old_root, seed)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: wrong_root,
    }

  spend_host_state(
    handle_packet_redeemer([], siblings, [], [], siblings, [], []),
    [test_host_input(old_state), test_channel_input_full(input_channel_datum)],
    [
      test_host_output(new_state),
      test_channel_output_full(output_channel_datum),
    ],
  )
}

test prop_host_bind_port_rejects_missing_authority(seed via fuzz.int()) fail {
  fuzz.label(@"fuzz.contract.host.bind_port.invalid_unauthorized")

  let port = positive_seed(seed % 1000)
  spend_test_bind_port([], [port], port, [])
}

test prop_host_bind_port_rejects_global_overflow(seed via fuzz.int()) {
  fuzz.label(@"fuzz.unit.host.bind_port.invalid_capacity")

  expect max_bound_ports == 10
  let port = 10 + positive_seed(seed % 1000)
  fuzz_dsl.mutated_check(
    "host",
    "bind_port",
    "global_capacity",
    "host_state.validate_bind_port",
    test_bind_port_transition(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, port],
      port,
    ),
  )
    |> fuzz_dsl.assert_rejected
}

test prop_host_bind_port_rejects_out_of_range_identifier(seed via fuzz.int()) {
  fuzz.label(@"fuzz.unit.host.bind_port.invalid_identifier")

  let offset = positive_seed(seed % 1000)
  let port =
    if seed % 2 == 0 {
      -1 - offset
    } else {
      max_port_number + 1 + offset
    }
  fuzz_dsl.mutated_check(
    "host",
    "bind_port",
    "identifier_range",
    "host_state.validate_bind_port",
    test_bind_port_transition([], [port], port),
  )
    |> fuzz_dsl.assert_rejected
}

/// This is the maximum-size HostState port-list transition permitted by the
/// protocol and is also collected by the transaction-budget CI job.
test host_state_bind_tenth_port_succeeds_at_global_cap() {
  expect max_bound_ports == 10
  spend_test_bind_port(
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    9,
    [trusted_deployer],
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

  let old_datum = test_host_state_datum(old_state, nft_policy)

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
  let registration = test_module_registration(test_module_script_hash())

  // For an empty tree, every sibling hash along the path is the empty hash.
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port)
  let port_value = cbor.serialise(registration)

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
      bound_port: [Pair(port, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

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
  let redeemer: HostStateRedeemer =
    BindPort { port, registration, port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
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

  let old_datum = test_host_state_datum(old_state, nft_policy)

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
  let registration = test_module_registration(test_module_script_hash())
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
      bound_port: [Pair(port, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: HostStateRedeemer =
    BindPort { port, registration, port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
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

  let old_datum = test_host_state_datum(old_state, nft_policy)

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
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port)
  let port_value = cbor.serialise(registration)

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
      bound_port: [Pair(port, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address: moved_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  let redeemer: HostStateRedeemer =
    BindPort { port, registration, port_siblings }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
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

  let old_datum = test_host_state_datum(old_state, nft_policy)

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
  let registration = test_module_registration(test_module_script_hash())

  // Compute the correct new root (still using the full witness list) so that the
  // only mismatch is the missing witness carried in the redeemer.
  let full_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let port_key = port_commitment_key(port)
  let port_value = cbor.serialise(registration)
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
      bound_port: [Pair(port, registration)],
    }

  let new_datum = test_host_state_datum(new_state, nft_policy)

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(new_datum),
      reference_script: None,
    }

  // Pass an empty witness list. The validator expects exactly `merkle_depth_bits`
  // hashes, so this must fail.
  let redeemer: HostStateRedeemer =
    BindPort { port, registration, port_siblings: [] }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output, test_module_output(registration)],
      extra_signatories: [trusted_deployer],
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

  let old_datum = test_host_state_datum(old_state, nft_policy)

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
  let registration = test_module_registration(test_module_script_hash())
  let port_siblings =
    repeat_bytearray(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )

  let redeemer: HostStateRedeemer =
    BindPort { port, registration, port_siblings }

  // No HostState output is produced, so the STT validator must fail.
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [],
      extra_signatories: [trusted_deployer],
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

test host_state_enter_shutdown_succeeds_with_deployer_signature() {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let address = Address(Script(host_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 1000,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: 2000,
    }

  let grace_period_end = 5000
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
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(
          new_state,
          nft_policy,
          ShuttingDown {
            initiated_at: new_state.last_update_time,
            grace_period_end,
          },
        ),
      ),
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [host_output],
      extra_signatories: [trusted_deployer],
    }

  let redeemer: HostStateRedeemer = EnterShutdown { grace_period_end }

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

test host_state_enter_shutdown_fails_without_deployer_signature() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let address = Address(Script(host_script_hash), None)

  let old_state =
    HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 1000,
    }

  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: 2000,
    }

  let grace_period_end = 5000
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
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(
          new_state,
          nft_policy,
          ShuttingDown {
            initiated_at: new_state.last_update_time,
            grace_period_end,
          },
        ),
      ),
      reference_script: None,
    }

  let transaction =
    Transaction { ..placeholder, inputs: [host_input], outputs: [host_output] }

  let redeemer: HostStateRedeemer = EnterShutdown { grace_period_end }

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

test host_state_finalize_shutdown_succeeds_after_grace_period() {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let host_address = Address(Script(host_script_hash), None)
  let reclaimed_address = Address(Script(dummy_script_hash), None)
  let grace_period_end = 5000

  let old_state =
    HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 2000,
    }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(
            old_state,
            nft_policy,
            ShuttingDown {
              initiated_at: old_state.last_update_time,
              grace_period_end,
            },
          ),
        ),
        reference_script: None,
      },
    )

  let reclaimed_output =
    Output {
      address: reclaimed_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [reclaimed_output],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(grace_period_end),
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    FinalizeShutdown,
    input_ref,
    transaction,
  )
}

test host_state_finalize_shutdown_fails_before_grace_period() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let host_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  let dummy_script_hash =
    #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
  let host_address = Address(Script(host_script_hash), None)
  let reclaimed_address = Address(Script(dummy_script_hash), None)
  let grace_period_end = 5000

  let old_state =
    HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 2000,
    }

  let input_ref =
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    }

  let host_input =
    Input(
      input_ref,
      Output {
        address: host_address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(
            old_state,
            nft_policy,
            ShuttingDown {
              initiated_at: old_state.last_update_time,
              grace_period_end,
            },
          ),
        ),
        reference_script: None,
      },
    )

  let reclaimed_output =
    Output {
      address: reclaimed_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      outputs: [reclaimed_output],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(grace_period_end - 1),
    }

  host_state_stt.host_state_stt.spend(
    nft_policy,
    dummy_script_hash,
    dummy_script_hash,
    dummy_script_hash,
    None,
    FinalizeShutdown,
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
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address: host_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(test_host_state_datum(new_state, nft_policy)),
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
        datum: InlineDatum(test_host_state_datum(old_state, nft_policy)),
        reference_script: None,
      },
    )

  let host_output =
    Output {
      address: host_address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(test_host_state_datum(new_state, nft_policy)),
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

test host_state_heartbeat_preserves_ibc_state() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_finds_host_output_first() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state), ..test_unrelated_outputs(8)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_finds_host_output_middle() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let outputs =
    list.concat(
      test_unrelated_outputs(4),
      [test_host_output(new_state), ..test_unrelated_outputs(4)],
    )

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    outputs,
    [trusted_deployer],
  )
}

test host_state_heartbeat_finds_host_output_last() {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let outputs =
    list.concat(test_unrelated_outputs(8), [test_host_output(new_state)])

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    outputs,
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_duplicate_host_outputs() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let host_output = test_host_output(new_state)

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [host_output, host_output],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_unauthorized_signer() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
  )
}

test host_state_heartbeat_rejects_root_change() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      ibc_state_root: #"22",
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_counter_change() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      next_client_sequence: old_state.next_client_sequence + 1,
      last_update_time: old_state.last_update_time + 1,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_stale_timestamp() fail {
  let old_state = test_host_state(#"11", 1000)
  let new_state = HostState { ..old_state, version: old_state.version + 1 }

  spend_host_state_with_signatories(
    Heartbeat,
    [test_host_input(old_state)],
    [test_host_output(new_state)],
    [trusted_deployer],
  )
}

test host_state_heartbeat_rejects_shutdown_state() fail {
  let nft_policy = test_nft_policy()
  let old_state = test_host_state(#"11", 1000)
  let new_state =
    HostState {
      ..old_state,
      version: old_state.version + 1,
      last_update_time: old_state.last_update_time + 1,
    }
  let shutdown =
    ShuttingDown {
      initiated_at: old_state.last_update_time,
      grace_period_end: old_state.last_update_time + 1000,
    }
  let address = Address(Script(test_host_script_hash()), None)
  let host_input =
    Input(
      test_host_ref(),
      Output {
        address,
        value: from_asset(nft_policy, host_state_token_name, 1),
        datum: InlineDatum(
          test_host_state_datum_with_shutdown(old_state, nft_policy, shutdown),
        ),
        reference_script: None,
      },
    )
  let host_output =
    Output {
      address,
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(
        test_host_state_datum_with_shutdown(new_state, nft_policy, shutdown),
      ),
      reference_script: None,
    }

  spend_host_state_with_signatories(
    Heartbeat,
    [host_input],
    [host_output],
    [trusted_deployer],
  )
}
