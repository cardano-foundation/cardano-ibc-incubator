use aiken/hash.{Blake2b_224, Hash}
use aiken/interval
use aiken/list
use aiken/pairs
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId, ValidityRange,
}
use aiken/transaction/credential.{Script}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembership, VerifyMembershipParams,
  VerifyProofRedeemer,
}
use ibc/client/mithril_client/client_state as mithril_client_state
use ibc/client/mithril_client/protos/mithril_pb.{
  AnyMithrilClientState, Fraction, MithrilClientState, MithrilHeight,
  MithrilProtocolParameters,
}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenAck, ConnOpenConfirm, SpendConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  InnerSpec, LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/utils/test_utils
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  fn spend_connection(
    datum: ConnectionDatum,
    redeemer: SpendConnectionRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction { outputs, reference_inputs, validity_range, redeemers, .. } =
      transaction

    expect spent_output |> auth.contain_auth_token(datum.token)
    trace @"spend_connection: input contains auth token"

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ConnectionDatum =
      validator_utils.get_inline_datum(updated_output)
    trace @"spend_connection: found connection output"

    expect auth.contain_auth_token(updated_output, datum.token)
    trace @"spend_connection: output contains connection token"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"spend_connection: extract tx valid_to"

    expect Some(connection_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let connection_id =
      conn_keys.format_connection_identifier(connection_sequence)
    trace @"spend_connection: extract connection_id"

    when redeemer is {
      ConnOpenAck(
        counterparty_client_state,
        proof_try,
        proof_client,
        proof_height,
      ) -> {
        trace @"spend_connection: ConnOpenAck branch"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            datum.state.client_id,
          )
        trace @"spend_connection: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"spend_connection: client status is active"

        expect
          connection_datum.is_connection_open_ack_valid(datum, updated_datum)
        trace @"spend_connection: connection datum is updated valid"

        expect
          validate_conn_open_ack_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            counterparty_client_state,
            proof_try,
            proof_client,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )
        trace @"spend_connection: validate_conn_open_ack_proof"

        True
      }
      ConnOpenConfirm { proof_ack, proof_height } -> {
        trace @"spend_connection: ConnOpenConfirm branch"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            datum.state.client_id,
          )
        trace @"spend_connection: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"spend_connection: client status is active"

        expect
          connection_datum.is_connection_open_confirm_valid(
            datum,
            updated_datum,
          )
        trace @"spend_connection: connection datum is updated valid"

        expect
          validate_conn_open_confirm_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            proof_ack,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )
        trace @"spend_connection: validate_conn_open_ack_proof"

        True
      }
    }
  }
}

fn validate_conn_open_ack_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
  counterparty_client_state: MithrilClientState,
  proof_try: MerkleProof,
  proof_client: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  expect mithril_client_state.validate_self_client(counterparty_client_state)

  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      connection_id,
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.TryOpen,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let conn_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )

  let client_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [client_keys.full_client_state_path(connection.counterparty.client_id)],
      ),
    )

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      Some(connection_end.convert_to_connection_end_proto(expected_connection)),
    )

  let counterparty_client_state_bz =
    mithril_pb.marshal_for_any_client_state(
      Some(
        AnyMithrilClientState {
          type_url: "/ibc.clients.mithril.v1.ClientState",
          value: Some(counterparty_client_state),
        },
      ),
    )

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  expect
    verify_proof_redeemer == BatchVerifyMembership(
      [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_try,
          path: conn_merkle_path,
          value: expected_connection_bz,
        },
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_client,
          path: client_merkle_path,
          value: counterparty_client_state_bz,
        },
      ],
    )

  True
}

fn validate_conn_open_confirm_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
  proof_ack: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      connection_id,
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.Open,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      Some(connection_end.convert_to_connection_end_proto(expected_connection)),
    )

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  expect
    verify_proof_redeemer == VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_ack,
      path: merkle_path,
      value: expected_connection_bz,
    }

  True
}

//================================================Test==============================================
type MockData {
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  connection_id: ByteArray,
  connection_token: AuthToken,
  handler_token: AuthToken,
  client_id: ByteArray,
  client_input: Input,
  validity_range: ValidityRange,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  //========================Client============================
  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"be42d79cf15375efd54cf594c9f016db8c8b8dc4e91f35f11bba000ec7e9f439",
      root: MerkleRoot {
        hash: #"3d89dd39e1f1c7a0cec08f3ebf31fcb485f42068fcb79a8aeb3a9ca9f4e7091d",
      },
    }

  let proof_specs =
    [
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 33,
          min_prefix_length: 4,
          max_prefix_length: 12,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 32,
          min_prefix_length: 1,
          max_prefix_length: 1,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
    ]

  let client_state =
    ClientState {
      chain_id: "testchain1-1",
      trust_level: unchecked_rational.from_int(1),
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: Height { revision_number: 1, revision_height: 13 },
      proof_specs,
    }

  let client_id = "ibc_client-44"

  let client_sequence = client_keys_mod.parse_client_id_sequence(client_id)

  let client_token_name =
    auth.generate_token_name(
      handler_token,
      client_keys_mod.client_prefix,
      client_sequence,
    )

  let client_minting_policy_id = "mock client_minting_policy_id"

  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: [Pair(proof_height, cons_state)],
      },
      token: client_token,
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "tx_hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("mock client script hash"),
        value: value.from_asset(client_token.policy_id, client_token.name, 1),
        datum: InlineDatum(client_datum),
        reference_script: None,
      },
    }

  //==========================ValidityRange===========================
  let valid_to =
    ( cons_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1
  let validity_range = interval.before(valid_to)

  //==========================Connection===============================
  let connection_id = "connection-43"
  let connection_sequence =
    conn_keys.parse_connection_id_sequence(connection_id)
  let connection_token_name =
    auth.generate_token_name(
      handler_token,
      conn_keys.connection_prefix,
      connection_sequence,
    )
  let connection_token =
    AuthToken {
      policy_id: "mock connection policy_id",
      name: connection_token_name,
    }

  MockData {
    client_minting_policy_id,
    verify_proof_policy_id: "mock verify_proof_policy_id",
    spend_connection_script_hash: "mock spend_connection_script_hash",
    connection_id,
    connection_token,
    handler_token,
    client_id,
    client_input,
    validity_range,
  }
}

fn build_output(datum: Data, token: AuthToken) -> Output {
  let output =
    Output {
      address: credential.from_script("mock script hash"),
      value: value.from_asset(token.policy_id, token.name, 1),
      datum: InlineDatum(datum),
      reference_script: None,
    }

  output
}

fn build_input(datum: Data, token: AuthToken) -> Input {
  let output = build_output(datum, token)

  let input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "mock tx hash" },
        output_index: 0,
      },
      output,
    }

  input
}

test conn_open_ack_succeed() {
  let mock = setup()

  //========================arrange inputs=======================
  let input_conn =
    ConnectionEnd {
      client_id: mock.client_id,
      versions: version.get_compatible_versions(),
      state: connection_state.Init,
      counterparty: Counterparty {
        client_id: #"3039392d63617264616e6f2d3430",
        connection_id: "",
        prefix: MerklePrefix { key_prefix: #"696263" },
      },
      delay_period: 0,
    }

  let input_conn_datum =
    ConnectionDatum { state: input_conn, token: mock.connection_token }

  let conn_input = build_input(input_conn, mock.connection_token)

  let inputs =
    [conn_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 0, revision_height: 188485 }

  let cons_state =
    ConsensusState {
      timestamp: 1711966816442701366,
      next_validators_hash: #"f88f12713a51934a3dc227fb41830b06e61db5b9518af2ac5b4d549f0f516ac5",
      root: MerkleRoot {
        hash: #"cc4f52848dc32a5ccc85f2aac7c14fae959173570915db4ed9408b1ebdf10afe",
      },
    }

  let client_input =
    test_utils.update_client(proof_height, cons_state, mock.client_input)

  let reference_inputs =
    [client_input]

  //========================arrange outputs=======================
  let output_conn_datum =
    ConnectionDatum {
      ..input_conn_datum,
      state: ConnectionEnd {
        ..input_conn_datum.state,
        state: connection_state.Open,
        counterparty: Counterparty {
          ..input_conn_datum.state.counterparty,
          connection_id: #"636f6e6e656374696f6e2d3232",
        },
      },
    }

  let conn_output = build_output(output_conn_datum, mock.connection_token)

  let outputs =
    [conn_output]

  //========================arrange validity_range=======================
  let validity_range = mock.validity_range

  //========================arrange redeemers=======================
  let counterparty_client_state =
    MithrilClientState {
      chain_id: "42",
      latest_height: Some(MithrilHeight { mithril_height: 1 }),
      frozen_height: Some(MithrilHeight { mithril_height: 0 }),
      current_epoch: 1,
      trusting_period: 1,
      protocol_parameters: Some(
        MithrilProtocolParameters {
          k: 0,
          m: 0,
          phi_f: Some(Fraction { numerator: 0, denominator: 1 }),
        },
      ),
      upgrade_path: [],
    }

  let proof_try = MerkleProof { proofs: [] }

  let proof_client = MerkleProof { proofs: [] }

  let connection_redeemer: Redeemer =
    ConnOpenAck {
      counterparty_client_state,
      proof_try,
      proof_client,
      proof_height,
    }

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)

  let client_datum_state = client_datum.state
  let connection = output_conn_datum.state

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let conn_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [connection_keys.connection_path(connection.counterparty.connection_id)],
      ),
    )

  let client_merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [client_keys.full_client_state_path(connection.counterparty.client_id)],
      ),
    )

  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      mock.connection_id,
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.TryOpen,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      Some(connection_end.convert_to_connection_end_proto(expected_connection)),
    )

  let counterparty_client_state_bz =
    mithril_pb.marshal_for_any_client_state(
      Some(
        AnyMithrilClientState {
          type_url: "/ibc.clients.mithril.v1.ClientState",
          value: Some(counterparty_client_state),
        },
      ),
    )

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let verify_proof_redeemer: Redeemer =
    BatchVerifyMembership(
      [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_try,
          path: conn_merkle_path,
          value: expected_connection_bz,
        },
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_client,
          path: client_merkle_path,
          value: counterparty_client_state_bz,
        },
      ],
    )

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(conn_input.output_reference), connection_redeemer),
      Pair(Mint(mock.verify_proof_policy_id), verify_proof_redeemer),
    ]

  expect connection_redeemer: SpendConnectionRedeemer = connection_redeemer

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(conn_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_connection(
    mock.client_minting_policy_id,
    mock.verify_proof_policy_id,
    input_conn_datum,
    connection_redeemer,
    context,
  )
}
