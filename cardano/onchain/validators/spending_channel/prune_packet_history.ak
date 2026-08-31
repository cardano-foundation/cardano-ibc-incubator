use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, Redeemer, ScriptPurpose, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyNonMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as connection_state_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{PrunePacketHistory}
use ibc/core/ics_004/types/order as channel_order_mod
use ibc/core/ics_004/types/state as channel_state_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof} as merkle
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/validator_utils

/// Permissionlessly remove finalized packet history.
///
/// The counterparty non-membership proof establishes that the source packet
/// commitment has already been resolved. Unordered channels remove the receipt
/// and acknowledgement pair; ordered channels remove only the acknowledgement.
/// The channel transition advances its proof-height floor atomically with the
/// deletion, so no older commitment proof can replay the receive afterward.
validator prune_packet_history(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  mint(
    channel_token: AuthToken,
    prune_packet_history_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      mint,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = transaction

    expect
      validator_utils.require_exact_marker_mint(
        mint,
        prune_packet_history_policy_id,
        "",
        1,
      )

    let (datum, channel_redeemer, spent_output) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    let updated_output =
      validator_utils.find_unique_continuation_output(
        spent_output,
        outputs,
        datum.token,
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    expect PrunePacketHistory {
      sequence,
      proof_commitment_absence,
      proof_height,
    } = channel_redeemer

    let ChannelDatum { state: current_state, .. } = datum
    let ChannelDatumState {
      channel,
      minimum_receive_proof_height,
      maximum_receive_proof_height,
      ..
    } = current_state

    expect [connection_id] = channel.connection_hops
    let (connection_datum, client_datum) =
      validator_utils.validate_referred_connection_and_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_minting_policy_id,
        connection_id,
      )

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    let valid_commitment_absence =
      validate_source_commitment_absence(
        connection_datum.state,
        client_datum.state,
        channel.counterparty.port_id,
        channel.counterparty.channel_id,
        sequence,
        proof_height,
        proof_commitment_absence,
        redeemers,
        verify_proof_policy_id,
      )

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      channel.state == channel_state_mod.Open,
      channel.ordering == channel_order_mod.Unordered || channel.ordering == channel_order_mod.Ordered,
      connection_datum.state.state == connection_state_mod.Open,
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active,
      height_mod.compare(proof_height, minimum_receive_proof_height) != Less,
      height_mod.compare(proof_height, maximum_receive_proof_height) != Less,
      valid_commitment_absence,
      channel_datum_mod.validate_prune_packet_history(
        datum,
        updated_datum,
        sequence,
        proof_height,
      ),
    }
  }

  else(_) {
    fail
  }
}

fn validate_source_commitment_absence(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  source_port: ByteArray,
  source_channel: ByteArray,
  sequence: Int,
  proof_height: Height,
  proof: MerkleProof,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)
  let path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            source_port,
            source_channel,
            sequence,
          ),
        ],
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

  verify_proof_redeemer == VerifyNonMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    processed_time,
    processed_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path,
  }
}
