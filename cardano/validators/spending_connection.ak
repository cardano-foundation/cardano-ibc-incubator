use aiken/list
use aiken/transaction.{Output, ScriptContext, Transaction}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/cardano_client/client_state as cardano_client
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenAck, ConnOpenConfirm, SpendConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify as conn_verify
use ibc/core/ics_023_vector_commitments/merkle_prefix
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/utils/validator_utils

validator(client_minting_policy_id: PolicyId) {
  fn spend_connection(
    datum: ConnectionDatum,
    redeemer: SpendConnectionRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction { outputs, reference_inputs, validity_range, .. } =
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
        trace @"spend_connection: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"spend_connection: client status is active\n"

        expect
          connection_datum.is_connection_open_ack_valid(datum, updated_datum)
        trace @"spend_connection: connection datum is updated valid\n"

        expect
          validate_conn_open_ack_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            counterparty_client_state,
            proof_try,
            proof_client,
            proof_height,
          )
        trace @"spend_connection: validate_conn_open_ack_proof\n"

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
        trace @"spend_connection: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"spend_connection: client status is active\n"

        expect
          connection_datum.is_connection_open_confirm_valid(
            datum,
            updated_datum,
          )
        trace @"spend_connection: connection datum is updated valid\n"

        expect
          validate_conn_open_confirm_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            proof_ack,
            proof_height,
          )
        trace @"spend_connection: validate_conn_open_ack_proof\n"

        True
      }
    }
  }
}

fn validate_conn_open_ack_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
  counterparty_client_state: cardano_client.ClientState,
  proof_try: ByteArray,
  proof_client: ByteArray,
  proof_height: Height,
) -> Bool {
  expect cardano_client.validate_self_client(counterparty_client_state)

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

  expect
    conn_verify.verify_connection_state(
      client_datum_state,
      connection,
      expected_connection,
      proof_try,
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

fn validate_conn_open_confirm_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
  proof_ack: ByteArray,
  proof_height: Height,
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

  expect
    conn_verify.verify_connection_state(
      client_datum_state,
      connection,
      expected_connection,
      proof_ack,
      proof_height,
    )

  True
}
