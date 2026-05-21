use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Input, Mint, OutputReference, Redeemer, ScriptPurpose, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenAck, ConnOpenConfirm, SpendConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_023_vector_commitments/merkle_prefix
use ibc/core/ics_024_host_requirements/connection_keys.{default_merkle_prefix}
use ibc/utils/validator_utils

validator spend_connection(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  spend(
    datum: Option<ConnectionDatum>,
    redeemer: SpendConnectionRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      reference_inputs,
      validity_range,
      redeemers,
      ..
    } = transaction

    // Connection handshakes must use the matching HostState root verifier branch.
    expect _ =
      validator_utils.require_host_state_redeemer(
        inputs,
        outputs,
        redeemers,
        host_state_nft_policy_id,
        validator_utils.ExpectUpdateConnection,
      )

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    expect Some(datum) = datum

    expect auth.contain_auth_token(spent_output, datum.token)
    trace @"spend_connection: input contains auth token"

    let updated_output =
      validator_utils.find_unique_continuation_output(
        spent_output,
        outputs,
        datum.token,
      )
    expect updated_datum: ConnectionDatum =
      validator_utils.get_inline_datum(updated_output)
    trace @"spend_connection: found connection output"

    expect auth.contains_only_auth_tokens(updated_output, [datum.token])
    trace @"spend_connection: output contains connection token"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"spend_connection: extract tx valid_to"

    let connection_sequence = auth.extract_token_sequence(datum.token.name)
    let connection_id =
      conn_keys.format_connection_identifier(connection_sequence)
    trace @"spend_connection: extract connection_id"

    when redeemer is {
      ConnOpenAck -> {
        trace @"spend_connection: ConnOpenAck branch"

        let client_datum =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            datum.state.client_id,
          )
        trace @"spend_connection: validator_utils.validate_referred_client"

        let connection_state_active =
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"spend_connection: client status is active"

        let valid_connection =
          validate_conn_open_ack_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            redeemers,
            verify_proof_policy_id,
          )

        and {
          valid_connection?,
          connection_datum.is_connection_open_ack_valid(datum, updated_datum)?,
          connection_state_active?,
        }
      }
      ConnOpenConfirm { proof_ack, proof_height } -> {
        trace @"spend_connection: ConnOpenConfirm branch"

        let client_datum =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            datum.state.client_id,
          )
        trace @"spend_connection: validator_utils.validate_referred_client"

        let is_status_active =
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"spend_connection: client status is active"

        let is_connection_open =
          connection_datum.is_connection_open_confirm_valid(
            datum,
            updated_datum,
          )
        trace @"spend_connection: connection datum is updated valid"

        let valid_connection =
          validate_conn_open_confirm_proof(
            client_datum.state,
            connection_id,
            updated_datum.state,
            proof_ack,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )

        and {
          is_status_active?,
          is_connection_open?,
          valid_connection?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_conn_open_ack_proof(
  client_datum_state: ClientDatumState,
  connection_id: ByteArray,
  connection: ConnectionEnd,
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

  let expected_connection_bz =
    connection_pb.marshal_for_connection_end(
      connection_end.convert_to_connection_end_proto(expected_connection),
    )

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let valid_proof_redeemer =
    when verify_proof_redeemer is {
      VerifyMembership {
        cs,
        cons_state,
        height,
        processed_time: redeemer_processed_time,
        processed_height: redeemer_processed_height,
        delay_time_period,
        delay_block_period,
        proof: _proof,
        path,
        value,
      } -> {
        expect Some(expected_consensus_state) =
          pairs.get_first(client_datum_state.consensus_states, height)
        expect Some(processed_time) =
          pairs.get_first(client_datum_state.processed_times, height)
        expect Some(processed_height) =
          pairs.get_first(client_datum_state.processed_heights, height)

        // Avoid relying on derived equality for `MerklePath`/`List<ByteArray>` inside
        // the redeemer match. For IBC on Cosmos, proofs are always built for a 2-level
        // path (store prefix + key), so we assert the shape and compare element-wise.
        expect [item0_prefix, item0_key] = path.key_path
        expect [exp0_prefix, exp0_key] = conn_merkle_path.key_path

        let ok0_path = and {
            item0_prefix == exp0_prefix,
            item0_key == exp0_key,
          }

        and {
          cs == client_datum_state.client_state,
          cons_state == expected_consensus_state,
          delay_time_period == time_delay,
          delay_block_period == block_delay,
          redeemer_processed_time == processed_time,
          redeemer_processed_height == processed_height,
          ok0_path,
          value == expected_connection_bz,
        }
      }
      _ -> False
    }

  valid_proof_redeemer?
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
      connection_end.convert_to_connection_end_proto(expected_connection),
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
  expect Some(processed_time) =
    pairs.get_first(client_datum_state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(client_datum_state.processed_heights, proof_height)

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  (verify_proof_redeemer == VerifyMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    processed_time,
    processed_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof: proof_ack,
    path: merkle_path,
    value: expected_connection_bz,
  })?
}
