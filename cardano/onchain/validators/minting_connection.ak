use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, Redeemer, ScriptPurpose, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  BatchVerifyMembership, VerifyMembershipParams, VerifyProofRedeemer,
}
use ibc/client/mithril_client/client_state as mithril_client_state
use ibc/client/mithril_client/protos/mithril_pb.{
  AnyMithrilClientState, MithrilClientState,
}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenInit, ConnOpenTry, MintConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_023_vector_commitments/merkle_prefix
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerConnOpenInit, HandlerConnOpenTry,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_connection(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
) {
  mint(
    redeemer: MintConnectionRedeemer,
    connection_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
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

        let handler_datum =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_auth_token,
            HandlerConnOpenInit,
          )
        trace @"mint_connection: validator_utils.validate_handler_redeemer"

        let client_datum =
          validator_utils.validate_referred_client(
            reference_inputs,
            connection_output_datum.token.name,
            client_minting_policy_id,
            connection_output_datum.state.client_id,
          )
        trace @"mint_connection: validator_utils.validate_referred_client"
        let client_state_active =
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_connection: client status is active"

        let connection_token =
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
        and {
          client_state_active?,
          auth.contains_only_auth_tokens(connection_output, [connection_token])?,
          connection_datum.is_conn_open_init_valid(
            connection_output_datum,
            connection_token,
          )?,
        }
      }
      ConnOpenTry {
        handler_auth_token,
        client_state,
        proof_init,
        proof_client,
        proof_height,
      } -> {
        trace @"mint_connection: ConnOpenTry branch\n"

        let handler_datum =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_auth_token,
            HandlerConnOpenTry,
          )
        trace @"mint_connection: validator_utils.validate_handler_redeemer\n"

        let client_datum =
          validator_utils.validate_referred_client(
            reference_inputs,
            connection_output_datum.token.name,
            client_minting_policy_id,
            connection_output_datum.state.client_id,
          )
        trace @"mint_connection: validator_utils.validate_referred_client\n"

        let client_state_active =
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_connection: client status is active\n"

        let connection_token =
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

        let is_open_connection =
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
            redeemers,
            verify_proof_policy_id,
          )
        and {
          client_state_active?,
          auth.contains_only_auth_tokens(connection_output, [connection_token])?,
          is_open_connection?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_conn_open_try_proof(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  counterparty_client_state: MithrilClientState,
  proof_init: MerkleProof,
  proof_client: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let valid_client =
    mithril_client_state.validate_self_client(counterparty_client_state)

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
      connection_end.convert_to_connection_end_proto(expected_connection),
    )

  let counterparty_client_state_bz_lightclients =
    mithril_pb.marshal_for_any_client_state(
      AnyMithrilClientState {
        type_url: "/ibc.lightclients.mithril.v1.ClientState",
        value: counterparty_client_state,
      },
    ).2nd

  let counterparty_client_state_bz_clients =
    mithril_pb.marshal_for_any_client_state(
      AnyMithrilClientState {
        type_url: "/ibc.clients.mithril.v1.ClientState",
        value: counterparty_client_state,
      },
    ).2nd

  let counterparty_client_state_bz_lightclients_with_zero_frozen =
    mithril_pb.marshal_for_any_client_state_with_zero_frozen(
      AnyMithrilClientState {
        type_url: "/ibc.lightclients.mithril.v1.ClientState",
        value: counterparty_client_state,
      },
    ).2nd

  let counterparty_client_state_bz_clients_with_zero_frozen =
    mithril_pb.marshal_for_any_client_state_with_zero_frozen(
      AnyMithrilClientState {
        type_url: "/ibc.clients.mithril.v1.ClientState",
        value: counterparty_client_state,
      },
    ).2nd

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let valid_proof_redeemer = or {
    verify_proof_redeemer == BatchVerifyMembership(
      [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_init,
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
          value: counterparty_client_state_bz_lightclients,
        },
      ],
    ),
    verify_proof_redeemer == BatchVerifyMembership(
      [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_init,
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
          value: counterparty_client_state_bz_clients,
        },
      ],
    ),
    verify_proof_redeemer == BatchVerifyMembership(
      [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_init,
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
          value: counterparty_client_state_bz_lightclients_with_zero_frozen,
        },
      ],
    ),
    verify_proof_redeemer == BatchVerifyMembership(
      [
        VerifyMembershipParams {
          cs: client_datum_state.client_state,
          cons_state: consensus_state,
          height: proof_height,
          delay_time_period: time_delay,
          delay_block_period: block_delay,
          proof: proof_init,
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
          value: counterparty_client_state_bz_clients_with_zero_frozen,
        },
      ],
    ),
  }

  and {
    valid_client,
    valid_proof_redeemer,
  }
}
