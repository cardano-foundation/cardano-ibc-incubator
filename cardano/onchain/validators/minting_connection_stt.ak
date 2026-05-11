// IBC Connection Minting Validator - STT Architecture

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Mint, Redeemer, ScriptPurpose, Spend, Transaction,
}
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
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionDatum, is_conn_open_init_valid, is_conn_open_try_valid,
}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenInit, ConnOpenTry, MintConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty as counterparty
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_023_vector_commitments/merkle_prefix
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateConnection, HostStateRedeemer,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      let quantity =
        quantity_of(input.output.value, nft_policy, host_state_token_name)
      quantity == 1
    },
  )
}

fn spent_host_state_for_create_connection(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_state_input: Input,
) -> Bool {
  expect Some(spend_redeemer) =
    pairs.get_first(redeemers, Spend(host_state_input.output_reference))
  expect host_redeemer: HostStateRedeemer = spend_redeemer

  // Connection tokens are minted only alongside the HostState transition that
  // consumes the current connection sequence.
  when host_redeemer is {
    CreateConnection { .. } -> True
    _ -> False
  }
}

validator mint_connection_stt(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
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

    expect Some(host_state_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)

    expect InlineDatum(datum) = host_state_input.output.datum
    expect host_state_datum: HostStateDatum = datum
    let connection_id_sequence = host_state_datum.state.next_connection_sequence

    expect [connection_output] =
      transaction.find_script_outputs(outputs, spend_connection_script_hash)
    expect connection_output_datum: ConnectionDatum =
      validator_utils.get_inline_datum(connection_output)

    let client_datum =
      validator_utils.validate_referred_client(
        reference_inputs,
        connection_output_datum.token.name,
        client_minting_policy_id,
        connection_output_datum.state.client_id,
      )

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    let client_state_active =
      client_state.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == Active

    let id_str = string_utils.int_to_string(connection_id_sequence)
    let host_state_nft =
      AuthToken {
        policy_id: host_state_nft_policy_id,
        name: host_state_token_name,
      }
    let connection_token_name =
      auth.generate_token_name(
        host_state_nft,
        conn_keys.connection_prefix,
        id_str,
      )
    let connection_token =
      AuthToken {
        policy_id: connection_minting_policy_id,
        name: connection_token_name,
      }

    let valid_connection =
      when redeemer is {
        ConnOpenInit ->
          is_conn_open_init_valid(connection_output_datum, connection_token)
        ConnOpenTry { client_state, proof_init, proof_client, proof_height } ->
          and {
            is_conn_open_try_valid(connection_output_datum, connection_token)?,
            validate_conn_open_try_proof(
              client_datum.state,
              connection_output_datum.state,
              client_state,
              proof_init,
              proof_client,
              proof_height,
              redeemers,
              verify_proof_policy_id,
            )?,
          }
      }

    and {
      client_state_active?,
      auth.mint_auth_token(mint, connection_token)?,
      auth.contains_only_auth_tokens(connection_output, [connection_token])?,
      valid_connection?,
      spent_host_state_for_create_connection(redeemers, host_state_input)?,
    }
  }

  else(_) {
    fail
  }
}

fn validate_conn_open_try_proof(
  client_datum_state: ClientDatumState,
  connection: ConnectionEnd,
  counterparty_client_state: ByteArray,
  proof_init: MerkleProof,
  proof_client: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
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

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

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
        value: counterparty_client_state,
      },
    ],
  )
}
