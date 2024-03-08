use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction.{Mint, ScriptContext, Transaction}
use aiken/transaction/credential.{Script}
use aiken/transaction/value.{PolicyId}
use ibc/auth
use ibc/client/cardano_client/client_state as cardano_client
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenInit, ConnOpenTry, MintConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify as conn_verify
use ibc/core/ics_023_vector_commitments/merkle_prefix
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerConnOpenInit, HandlerConnOpenTry,
}
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
        trace @"mint_connection: ConnOpenInit branch\n"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_auth_token,
            HandlerConnOpenInit,
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
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_connection: client status is active\n"

        expect Some(connection_token) =
          validator_utils.validate_mint(
            mint,
            connection_minting_policy_id,
            handler_auth_token,
            conn_keys.connection_prefix,
            handler_datum.state.next_connection_sequence,
          )
        trace @"mint_connection: validator_utils.validate_mint\n"

        expect auth.contain_auth_token(connection_output, connection_token)
        trace @"mint_connection: output contains connection token"

        expect
          connection_datum.is_conn_open_init_valid(
            connection_output_datum,
            connection_token,
          )
        trace @"mint_connection: connection datum is valid\n"

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
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_connection: client status is active\n"

        expect Some(connection_token) =
          validator_utils.validate_mint(
            mint,
            connection_minting_policy_id,
            handler_auth_token,
            conn_keys.connection_prefix,
            handler_datum.state.next_connection_sequence,
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
  counterparty_client_state: cardano_client.ClientState,
  proof_init: ByteArray,
  proof_client: ByteArray,
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
