use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Hash}
use aiken/interval
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId, ValidityRange,
}
use aiken/transaction/credential.{Script}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/cardano_client/client_state as cardano_client
use ibc/client/cardano_client/protos/cardano_pb.{CardanoClientState}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenInit, ConnOpenTry, MintConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify as conn_verify
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  InnerSpec, LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerConnOpenInit, HandlerConnOpenTry,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
) {
  fn mint_connection(
    redeemer: MintConnectionRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let ScriptContext { transaction, purpose } = context
    expect Mint(connection_minting_policy_id) = purpose
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      mint,
      validity_range,
      redeemers,
      ..
    } = transaction

    expect [connection_output] =
      outputs
        |> transaction.find_script_outputs(spend_connection_script_hash)
    expect connection_output_datum: ConnectionDatum =
      validator_utils.get_inline_datum(connection_output)
    trace @"mint_connection: found connection output"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"mint_connection: validator_utils.get_tx_valid_to"

    when redeemer is {
      ConnOpenInit { handler_auth_token } -> {
        trace @"mint_connection: ConnOpenInit branch"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_auth_token,
            HandlerConnOpenInit,
          )
        trace @"mint_connection: validator_utils.validate_handler_redeemer"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            connection_output_datum.token.name,
            client_minting_policy_id,
            connection_output_datum.state.client_id,
          )
        trace @"mint_connection: validator_utils.validate_referred_client"
        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == Active
        trace @"mint_connection: client status is active"

        expect Some(connection_token) =
          string_utils.int_to_string(
            handler_datum.state.next_connection_sequence,
          )
            |> validator_utils.validate_mint(
                mint,
                connection_minting_policy_id,
                handler_auth_token,
                conn_keys.connection_prefix,
                _,
              )
        trace @"mint_connection: validator_utils.validate_mint"

        expect auth.contain_auth_token(connection_output, connection_token)
        trace @"mint_connection: output contains connection token"

        expect
          connection_datum.is_conn_open_init_valid(
            connection_output_datum,
            connection_token,
          )
        trace @"mint_connection: connection datum is valid"

        True
      }
      ConnOpenTry {
        handler_auth_token,
        client_state,
        proof_init,
        proof_client,
        proof_height,
      } -> {
        trace @"mint_connection: ConnOpenTry branch\n"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_auth_token,
            HandlerConnOpenTry,
          )
        trace @"mint_connection: validator_utils.validate_handler_redeemer\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            connection_output_datum.token.name,
            client_minting_policy_id,
            connection_output_datum.state.client_id,
          )
        trace @"mint_connection: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == Active
        trace @"mint_connection: client status is active\n"

        expect Some(connection_token) =
          string_utils.int_to_string(
            handler_datum.state.next_connection_sequence,
          )
            |> validator_utils.validate_mint(
                mint,
                connection_minting_policy_id,
                handler_auth_token,
                conn_keys.connection_prefix,
                _,
              )
        trace @"mint_connection: validator_utils.validate_mint\n"

        expect auth.contain_auth_token(connection_output, connection_token)
        trace @"mint_connection: output contains connection token"

        expect
          connection_datum.is_conn_open_try_valid(
            connection_output_datum,
            connection_token,
          )
        trace @"mint_connection: connection datum is valid\n"

        expect
          validate_conn_open_try_proof(
            client_datum.state,
            connection_output_datum.state,
            client_state,
            proof_init,
            proof_client,
            proof_height,
          )
        trace @"mint_connection: minting_connection.validate_conn_open_try_proof\n"

        True
      }
    }
  }
}

fn validate_conn_open_try_proof(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  counterparty_client_state: CardanoClientState,
  proof_init: MerkleProof,
  proof_client: MerkleProof,
  proof_height: Height,
) -> Bool {
  expect cardano_client.validate_self_client(counterparty_client_state)

  let expected_counterparty =
    counterparty.new_counterparty(
      connection.client_id,
      "",
      merkle_prefix.new_merkle_prefix(default_merkle_prefix),
    )

  let expected_connection =
    connection_end.new_connection_end(
      connection_state.Init,
      connection.counterparty.client_id,
      expected_counterparty,
      connection.versions,
      connection.delay_period,
    )

  expect
    conn_verify.verify_connection_state(
      client_datum_state,
      connection,
      expected_connection,
      proof_init,
      proof_height,
    )

  expect
    conn_verify.verify_client_state(
      client_datum_state,
      connection,
      counterparty_client_state,
      proof_client,
      proof_height,
    )

  True
}

//====================================================Test==============================================================
type MockData {
  client_minting_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  connection_minting_policy_id: PolicyId,
  connection_sequence: Int,
  handler_token: AuthToken,
  handler_input: Input,
  client_id: ByteArray,
  client_input: Input,
  validity_range: ValidityRange,
}

fn setup() -> MockData {
  //===========================Handler=============================
  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  let connection_sequence = 324

  let handler_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: 0,
        next_connection_sequence: connection_sequence,
        next_channel_sequence: 0,
        bound_port: [],
      },
      token: handler_token,
    }

  let spend_handler_output_reference =
    OutputReference {
      transaction_id: TransactionId { hash: "mock handler tx hash" },
      output_index: 0,
    }

  let handler_input =
    Input {
      output_reference: spend_handler_output_reference,
      output: Output {
        address: credential.from_script("mock handler script hash"),
        value: value.from_asset(handler_token.policy_id, handler_token.name, 1),
        datum: InlineDatum(handler_datum),
        reference_script: None,
      },
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

  let client_id = "ibc_client-10"

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
        consensus_states: dict.new()
          |> dict.insert(proof_height, cons_state, height_mod.compare)
          |> dict.to_list(),
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

  MockData {
    client_minting_policy_id,
    spend_connection_script_hash: "mock spend_connection_script_hash",
    connection_minting_policy_id: "mock connection_minting_policy_id",
    connection_sequence,
    handler_token,
    handler_input,
    client_id,
    client_input,
    validity_range,
  }
}

test conn_open_init_succeed() {
  let mock = setup()

  //====================arrange inputs==============================
  let inputs: List<Input> =
    [mock.handler_input]

  //====================arrange reference_inputs==============================
  let reference_inputs: List<Input> =
    [mock.client_input]

  //====================arrange outputs==================================
  let conn_token_name =
    string_utils.int_to_string(mock.connection_sequence)
      |> auth.generate_token_name(
          mock.handler_token,
          conn_keys.connection_prefix,
          _,
        )
  let conn_token =
    AuthToken {
      policy_id: mock.connection_minting_policy_id,
      name: conn_token_name,
    }

  let conn_end =
    ConnectionEnd {
      client_id: mock.client_id,
      versions: version.get_compatible_versions(),
      state: connection_state.Init,
      counterparty: Counterparty {
        client_id: "07-tendermint-1",
        connection_id: "",
        prefix: MerklePrefix { key_prefix: "mock_key_prefix" },
      },
      delay_period: 1,
    }

  let conn_datum = ConnectionDatum { state: conn_end, token: conn_token }

  let conn_output =
    Output {
      address: credential.from_script(mock.spend_connection_script_hash),
      value: value.from_asset(conn_token.policy_id, conn_token.name, 1),
      datum: InlineDatum(conn_datum),
      reference_script: None,
    }

  let outputs =
    [conn_output]

  //========================arrange mint=======================
  let mint =
    value.from_asset(conn_token.policy_id, conn_token.name, 1)
      |> value.to_minted_value()

  //========================arrange validity_range=======================
  let validity_range = mock.validity_range

  //========================arrange redeemers=======================
  let handler_redeemer: Redeemer = HandlerConnOpenInit

  let mint_conn_redeemer =
    ConnOpenInit { handler_auth_token: mock.handler_token }

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
          Spend(mock.handler_input.output_reference),
          handler_redeemer,
          validator_utils.compare_purpose,
        )
      |> dict.insert(
          Mint(mock.connection_minting_policy_id),
          mint_conn_redeemer,
          validator_utils.compare_purpose,
        )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Mint(mock.connection_minting_policy_id),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        mint: mint,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  mint_connection(
    mock.client_minting_policy_id,
    mock.spend_connection_script_hash,
    mint_conn_redeemer,
    context,
  )
}
