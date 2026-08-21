use aiken/builtin
use aiken/cbor
use aiken/fuzz
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{PolicyId, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, placeholder,
}
use host_state_stt
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembershipParams, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/keys as client_id_keys
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionActive, ConnectionDatum,
} as connection_datum
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenTry, MintConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd} as connection_end
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as counterparty
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix
use ibc/core/ics_024_host_requirements/client_keys as host_client_keys
use ibc/core/ics_024_host_requirements/connection_keys as host_connection_keys
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, empty_ibc_state_root, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateConnection, HostStateRedeemer,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{AuthorizeCreation}
use ibc/core/ics_025_handler_interface/reclamation
use ibc/testing/fuzz_dsl
use ibc/utils/bits
use ibc/utils/validator_utils
use minting_connection_stt
use minting_lifecycle_creation_marker

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

const lifecycle_creation_policy = "lifecycle creation policy"

const lifecycle_reclamation_policy = "lifecycle reclamation policy"

const lifecycle_operational_policy = "lifecycle operational policy"

const lifecycle_packet_policy = "lifecycle packet policy"

type ConnOpenTryFixture {
  ConnOpenTryFixture {
    transaction: Transaction,
    redeemer: MintConnectionRedeemer,
    connection_minting_policy_id: PolicyId,
    client_minting_policy_id: PolicyId,
    verify_proof_policy_id: PolicyId,
    host_state_nft_policy_id: PolicyId,
    spend_connection_script_hash: ByteArray,
    host_input: Input,
    host_redeemer: HostStateRedeemer,
    connection_datum: ConnectionDatum,
    connection_token: AuthToken,
    mutation: fuzz_dsl.Mutation,
  }
}

fn test_height(revision_height: Int) -> Height {
  Height { revision_number: 0, revision_height }
}

fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn full_empty_siblings() -> List<ByteArray> {
  repeat_bytearray(
    ibc_state_commitment.empty_hash,
    ibc_state_commitment.merkle_depth_bits,
  )
}

fn key_bit(key_hash: ByteArray, depth: Int) -> Int {
  let byte_index = 7 - depth / 8
  let bit_in_byte = depth % 8
  bits.shr(builtin.index_bytearray(key_hash, byte_index), bit_in_byte) % 2
}

fn last_different_key_bit(
  first_hash: ByteArray,
  second_hash: ByteArray,
  depth: Int,
  last_difference: Int,
) -> Int {
  if depth == ibc_state_commitment.merkle_depth_bits {
    expect last_difference >= 0
    last_difference
  } else {
    last_different_key_bit(
      first_hash,
      second_hash,
      depth + 1,
      if key_bit(first_hash, depth) != key_bit(second_hash, depth) {
        depth
      } else {
        last_difference
      },
    )
  }
}

fn raise_single_leaf(
  key_hash: ByteArray,
  current: ByteArray,
  depth: Int,
  target_depth: Int,
) -> ByteArray {
  if depth == target_depth {
    current
  } else {
    raise_single_leaf(
      key_hash,
      if key_bit(key_hash, depth) == 0 {
        ibc_state_commitment.inner_hash(
          current,
          ibc_state_commitment.empty_hash,
        )
      } else {
        ibc_state_commitment.inner_hash(
          ibc_state_commitment.empty_hash,
          current,
        )
      },
      depth + 1,
      target_depth,
    )
  }
}

fn single_sibling_list(
  depth: Int,
  sibling_depth: Int,
  sibling: ByteArray,
) -> List<ByteArray> {
  if depth == ibc_state_commitment.merkle_depth_bits {
    []
  } else {
    [
      if depth == sibling_depth {
        sibling
      } else {
        ibc_state_commitment.empty_hash
      },
      ..single_sibling_list(depth + 1, sibling_depth, sibling)
    ]
  }
}

fn siblings_after_single_insert(
  existing_key: ByteArray,
  existing_value: ByteArray,
  target_key: ByteArray,
) -> List<ByteArray> {
  let existing_key_hash = builtin.sha2_256(existing_key)
  let target_key_hash = builtin.sha2_256(target_key)
  let divergence =
    last_different_key_bit(existing_key_hash, target_key_hash, 0, -1)
  let existing_leaf =
    ibc_state_commitment.leaf_hash(
      existing_key_hash,
      ibc_state_commitment.value_hash(existing_value),
    )
  single_sibling_list(
    0,
    divergence,
    raise_single_leaf(existing_key_hash, existing_leaf, 0, divergence),
  )
}

fn output_ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
    output_index: index,
  }
}

fn consensus_state() -> ConsensusState {
  ConsensusState {
    timestamp: 1_000,
    next_validators_hash: #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5",
    root: MerkleRoot {
      hash: #"92dad9443e4dd6d70a7f11872101ebff87e21798e4fbb26fa4bf590eb440e71b",
    },
  }
}

fn active_client_state(proof_height: Height) -> ClientState {
  client_state.new_client_state(
    "testchain-0",
    unchecked_rational.from_int(1),
    10_000_000_000,
    20_000_000_000,
    10,
    proof_height,
    merkle.get_sdk_specs(),
  )
}

fn client_datum(client_token: AuthToken, proof_height: Height) -> ClientDatum {
  ClientDatum {
    state: ClientDatumState {
      client_state: active_client_state(proof_height),
      consensus_states: [Pair(proof_height, consensus_state())],
      processed_times: [Pair(proof_height, 0)],
      processed_heights: [Pair(proof_height, 0)],
    },
    token: client_token,
  }
}

fn host_state_datum(
  nft_policy: PolicyId,
  version: Int,
  root: ByteArray,
  next_connection_sequence: Int,
) -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version,
      ibc_state_root: root,
      next_client_sequence: 0,
      next_connection_sequence,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 1,
      live_connection_count: next_connection_sequence,
      live_channel_count: 0,
    },
    nft_policy,
    deployer: trusted_deployer,
    shutdown: Active,
  }
}

fn host_state_output(nft_policy: PolicyId, datum: HostStateDatum) -> Output {
  Output {
    address: from_script("host state script hash"),
    value: from_asset(nft_policy, host_state_token_name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn connection_output(
  script_hash: ByteArray,
  connection_token: AuthToken,
  datum: ConnectionDatum,
) -> Output {
  Output {
    address: from_script(script_hash),
    value: from_asset(connection_token.policy_id, connection_token.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn client_reference_input(
  client_token: AuthToken,
  proof_height: Height,
) -> Input {
  Input {
    output_reference: output_ref(1),
    output: Output {
      address: from_script("client script hash"),
      value: from_asset(client_token.policy_id, client_token.name, 1),
      datum: InlineDatum(client_datum(client_token, proof_height)),
      reference_script: None,
    },
  }
}

fn expected_counterparty_connection_bytes(
  connection: ConnectionEnd,
) -> ByteArray {
  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      "",
      merkle_prefix.new_merkle_prefix(
        host_connection_keys.default_merkle_prefix,
      ),
    )
  let expected_connection =
    connection_end.new_connection_end(
      connection_state.Init,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  connection_pb.marshal_for_connection_end(
    connection_end.convert_to_connection_end_proto(expected_connection),
  )
}

fn verify_proof_redeemer(
  client_datum: ClientDatum,
  connection: ConnectionEnd,
  proof_height: Height,
  proof_client_value: ByteArray,
) -> VerifyProofRedeemer {
  let proof = merkle.null_merkle_proof()
  let conn_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          host_connection_keys.connection_path(
            connection.counterparty.connection_id,
          ),
        ],
      ),
    )
  let client_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          host_client_keys.full_client_state_path(
            connection.counterparty.client_id,
          ),
        ],
      ),
    )

  BatchVerifyMembership(
    [
      VerifyMembershipParams {
        cs: client_datum.state.client_state,
        cons_state: consensus_state(),
        height: proof_height,
        processed_time: 0,
        processed_height: 0,
        delay_time_period: connection.delay_period,
        delay_block_period: 0,
        proof,
        path: conn_merkle_path,
        value: expected_counterparty_connection_bytes(connection),
      },
      VerifyMembershipParams {
        cs: client_datum.state.client_state,
        cons_state: consensus_state(),
        height: proof_height,
        processed_time: 0,
        processed_height: 0,
        delay_time_period: connection.delay_period,
        delay_block_period: 0,
        proof,
        path: client_merkle_path,
        value: proof_client_value,
      },
    ],
  )
}

fn build_conn_open_try_fixture(
  counterparty_client_state: ByteArray,
  proof_client_value: ByteArray,
  mutation: fuzz_dsl.Mutation,
) -> ConnOpenTryFixture {
  let host_state_nft_policy_id = "host state nft policy"
  let connection_minting_policy_id = "connection minting policy"
  let client_minting_policy_id = "client minting policy"
  let verify_proof_policy_id = "verify proof policy"
  let spend_connection_script_hash = "connection script hash"
  let proof_height = test_height(10)
  let connection_sequence = "0"
  let host_state_nft =
    AuthToken {
      policy_id: host_state_nft_policy_id,
      name: host_state_token_name,
    }
  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: auth.generate_token_name(
        host_state_nft,
        connection_keys.connection_prefix,
        connection_sequence,
      ),
    }
  let client_token =
    AuthToken {
      policy_id: client_minting_policy_id,
      name: auth.generate_token_name_from_another(
        connection_token.name,
        client_id_keys.client_prefix,
        "0",
      ),
    }
  let connection =
    ConnectionEnd {
      client_id: "07-tendermint-0",
      versions: [Version { identifier: "1", features: ["ORDER_UNORDERED"] }],
      state: connection_state.TryOpen,
      counterparty: Counterparty {
        client_id: "07-tendermint-9",
        connection_id: "connection-9",
        prefix: merkle_prefix.new_merkle_prefix(
          host_connection_keys.default_merkle_prefix,
        ),
      },
      delay_period: 0,
    }
  let connection_datum =
    ConnectionDatum {
      state: connection,
      token: connection_token,
      live_channel_count: 0,
      lifecycle: ConnectionActive,
    }
  let client_connection_count_key =
    reclamation.client_connection_count_path(connection.client_id)
  let old_client_connection_count = reclamation.encode_count(0)
  let old_host_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      client_connection_count_key,
      "",
      old_client_connection_count,
      full_empty_siblings(),
    )
  let old_host_datum =
    host_state_datum(host_state_nft_policy_id, 0, old_host_root, 0)
  let connection_key = host_connection_keys.connection_path("connection-0")
  let connection_value = cbor.serialise(connection)
  let connection_siblings =
    siblings_after_single_insert(
      client_connection_count_key,
      old_client_connection_count,
      connection_key,
    )
  let root_after_connection =
    ibc_state_commitment.apply_update(
      old_host_datum.state.ibc_state_root,
      connection_key,
      "",
      connection_value,
      connection_siblings,
    )
  let client_connection_count_siblings =
    siblings_after_single_insert(
      connection_key,
      connection_value,
      client_connection_count_key,
    )
  let new_host_root =
    ibc_state_commitment.apply_update(
      root_after_connection,
      client_connection_count_key,
      old_client_connection_count,
      reclamation.encode_count(1),
      client_connection_count_siblings,
    )
  let new_host_datum =
    host_state_datum(host_state_nft_policy_id, 1, new_host_root, 1)
  let host_input =
    Input {
      output_reference: output_ref(0),
      output: host_state_output(host_state_nft_policy_id, old_host_datum),
    }
  let client_input = client_reference_input(client_token, proof_height)
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  let proof_redeemer =
    verify_proof_redeemer(
      client_datum,
      connection,
      proof_height,
      proof_client_value,
    )
  let redeemer: MintConnectionRedeemer =
    ConnOpenTry {
      client_state: counterparty_client_state,
      proof_init: merkle.null_merkle_proof(),
      proof_client: merkle.null_merkle_proof(),
      proof_height,
    }
  let host_redeemer: HostStateRedeemer =
    CreateConnection {
      connection_siblings,
      client_connection_count: 0,
      client_connection_count_siblings,
    }
  let connection_output =
    connection_output(
      spend_connection_script_hash,
      connection_token,
      connection_datum,
    )
  let host_output =
    Output {
      ..host_state_output(host_state_nft_policy_id, new_host_datum),
      value: host_state_output(host_state_nft_policy_id, new_host_datum).value
        |> add(lifecycle_creation_policy, "ibc_lifecycle", 1),
    }
  let host_redeemer_data: Redeemer = host_redeemer
  let connection_redeemer_data: Redeemer = redeemer
  let proof_redeemer_data: Redeemer = proof_redeemer
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(host_input.output_reference), host_redeemer_data),
      Pair(Mint(connection_minting_policy_id), connection_redeemer_data),
      Pair(Mint(verify_proof_policy_id), proof_redeemer_data),
    ]
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input],
      reference_inputs: [client_input],
      outputs: [host_output, connection_output],
      mint: from_asset(connection_minting_policy_id, connection_token.name, 1)
        |> add(lifecycle_creation_policy, "ibc_lifecycle", 1),
      redeemers,
      validity_range: interval.before(1_000),
    }

  ConnOpenTryFixture {
    transaction,
    redeemer,
    connection_minting_policy_id,
    client_minting_policy_id,
    verify_proof_policy_id,
    host_state_nft_policy_id,
    spend_connection_script_hash,
    host_input,
    host_redeemer,
    connection_datum,
    connection_token,
    mutation,
  }
}

fn run_conn_open_try_transition(
  fixture: ConnOpenTryFixture,
) -> fuzz_dsl.ProtocolTxFixture {
  fuzz_dsl.protocol_tx_from_transaction(
    fuzz_dsl.model("conn", "open_try"),
    fuzz_dsl.model("conn", "open_try.after"),
    fixture.mutation,
    fixture.transaction,
  )
    |> fuzz_dsl.with_protocol_validator_check(
        "minting_connection_stt",
        minting_connection_stt.mint_connection_stt.mint(
          fixture.client_minting_policy_id,
          fixture.verify_proof_policy_id,
          fixture.spend_connection_script_hash,
          fixture.host_state_nft_policy_id,
          fixture.redeemer,
          fixture.connection_minting_policy_id,
          fixture.transaction,
        ),
      )
    |> fuzz_dsl.with_protocol_validator_check(
        "host_state_stt.create_connection",
        host_state_stt.host_state_stt.spend(
          fixture.host_state_nft_policy_id,
          "client script hash",
          fixture.spend_connection_script_hash,
          "channel script hash",
          fixture.client_minting_policy_id,
          fixture.connection_minting_policy_id,
          "channel minting policy id",
          lifecycle_creation_policy,
          lifecycle_reclamation_policy,
          lifecycle_operational_policy,
          lifecycle_packet_policy,
          None,
          fixture.host_redeemer,
          fixture.host_input.output_reference,
          fixture.transaction,
        ),
      )
    |> fuzz_dsl.with_protocol_validator_check(
        "minting_lifecycle_creation_marker.create_connection",
        minting_lifecycle_creation_marker.mint_lifecycle_creation_marker.mint(
          fixture.host_state_nft_policy_id,
          fixture.client_minting_policy_id,
          fixture.connection_minting_policy_id,
          "channel minting policy id",
          AuthorizeCreation,
          lifecycle_creation_policy,
          fixture.transaction,
        ),
      )
    |> fuzz_dsl.with_protocol_validator_check(
        "connection_datum.is_conn_open_try_valid",
        connection_datum.is_conn_open_try_valid(
          fixture.connection_datum,
          fixture.connection_token,
        ),
      )
}

fn validate_creation_marker(
  connection_policy: PolicyId,
  duplicate_connection_output: Bool,
) -> Bool {
  let fixture =
    build_conn_open_try_fixture(
      "client-state",
      "client-state",
      fuzz_dsl.no_mutation(),
    )
  expect [host_output, connection_output] = fixture.transaction.outputs
  let transaction =
    if duplicate_connection_output {
      Transaction {
        ..fixture.transaction,
        outputs: [host_output, connection_output, connection_output],
      }
    } else {
      fixture.transaction
    }
  minting_lifecycle_creation_marker.mint_lifecycle_creation_marker.mint(
    fixture.host_state_nft_policy_id,
    fixture.client_minting_policy_id,
    connection_policy,
    "channel minting policy id",
    AuthorizeCreation,
    lifecycle_creation_policy,
    transaction,
  )
}

test lifecycle_creation_marker_accepts_create_connection() {
  let fixture =
    build_conn_open_try_fixture(
      "client-state",
      "client-state",
      fuzz_dsl.no_mutation(),
    )
  validate_creation_marker(fixture.connection_minting_policy_id, False)
}

test lifecycle_creation_marker_rejects_forged_connection_policy() fail {
  validate_creation_marker("forged connection policy", False)
}

test lifecycle_creation_marker_rejects_extra_connection_output() fail {
  let fixture =
    build_conn_open_try_fixture(
      "client-state",
      "client-state",
      fuzz_dsl.no_mutation(),
    )
  validate_creation_marker(fixture.connection_minting_policy_id, True)
}

test prop_tx_conn_open_try_accepts_valid_full_transition(_seed via fuzz.int()) {
  fuzz.label(@"regression.tx.conn.open_try.valid_full_transition")

  // tx.* depth: the same ConnOpenTry transaction is checked by connection
  // minting, HostState CreateConnection, and the connection datum transition.
  build_conn_open_try_fixture(
    "client-state",
    "client-state",
    fuzz_dsl.no_mutation(),
  )
    |> run_conn_open_try_transition
    |> fuzz_dsl.assert_protocol_valid
}

test prop_conn_open_try_rejects_wrong_counterparty_client_state(
  _seed via fuzz.int(),
) {
  fuzz.label(@"regression.tx.conn.open_try.invalid_wrong_client_state_proof")

  // Near-valid ConnOpenTry: the local connection datum and proof plumbing are
  // valid, but the counterparty client state bytes differ from the proof value.
  build_conn_open_try_fixture(
    "client-state",
    "wrong-client-state",
    fuzz_dsl.mutation("wrong_counterparty_client_state"),
  )
    |> run_conn_open_try_transition
    |> fuzz_dsl.assert_protocol_rejected
}
