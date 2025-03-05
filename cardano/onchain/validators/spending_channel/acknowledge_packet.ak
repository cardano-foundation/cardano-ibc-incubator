use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Mint, Output, OutputReference, Redeemer, ScriptPurpose, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{AcknowledgePacket}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/validator_utils

validator acknowledge_packet(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    channel_token: AuthToken,
    _spent_output: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = transaction

    let (datum, channel_redeemer, spent_output) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    let channel_sequence = auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect AcknowledgePacket {
      packet,
      acknowledgement,
      proof_acked,
      proof_height,
    } = channel_redeemer

    trace @"acknowledge_packet: tx context extracted"

    trace @"acknowledge_packet: AcknowledgePacket branch"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState {
      channel: cur_channel,
      packet_commitment: cur_packet_commitment,
      next_sequence_ack,
      ..
    } = cur_channel_state

    expect [connection_id] = cur_channel.connection_hops

    let is_cur_chan_open = cur_channel.state == chan_state_mod.Open
    trace @"acknowledge_packet: channel state is open"

    let valid_packet = and {
        packet.source_port == port_id,
        packet.source_channel == channel_id,
        packet.destination_port == cur_channel.counterparty.port_id,
        packet.destination_channel == cur_channel.counterparty.channel_id,
      }
    trace @"acknowledge_packet: packet info matched channel state"

    let connection_datum =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"acknowledge_packet: reference_inputs contain Connection utxo"

    let is_connection_state_open =
      connection_datum.state.state == conn_state_mod.Open
    trace @"acknowledge_packet: connection state is open"

    let client_datum =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"acknowledge_packet: reference_inputs contain Client utxo"

    let is_client_status_active =
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"acknowledge_packet: client status is active"

    expect Some(commitment) =
      pairs.get_first(cur_packet_commitment, packet.sequence)
    trace @"acknowledge_packet: packet commitment existed"

    let valid_commitment = commitment == packet_mod.commit_packet(packet)
    let valid_packet_proof =
      validate_acknowledge_packet_proof(
        connection_datum.state,
        client_datum.state,
        proof_height,
        proof_acked,
        packet,
        acknowledgement,
        redeemers,
        verify_proof_policy_id,
      )
    trace @"acknowledge_packet: packet proof is valid"

    let is_packet_acknowledged =
      channel_datum_mod.validate_acknowledge_packet(
        datum,
        updated_datum,
        packet,
      )
    trace @"acknowledge_packet: channel datum is updated valid"

    let ibc_module_redeemer =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect OnAcknowledgementPacket { channel_id: module_chan_id, .. } =
      ibc_module_callback

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      is_connection_state_open,
      is_client_status_active,
      is_cur_chan_open,
      valid_packet,
      valid_commitment,
      is_packet_acknowledged,
      valid_packet_proof,
      cur_channel.ordering != chan_order_mod.Ordered || packet.sequence == next_sequence_ack,
      module_chan_id == channel_id,
    }
  }

  else(_) {
    fail
  }
}

fn validate_acknowledge_packet_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof: MerkleProof,
  packet: Packet,
  acknowledgement: ByteArray,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_acknowledgement_path(
            packet.destination_port,
            packet.destination_channel,
            packet.sequence,
          ),
        ],
      ),
    )
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let commit_ack = acknowledgement_mod.commit_acknowledgement(acknowledgement)

  verify_proof_redeemer == VerifyMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path: merkle_path,
    value: commit_ack,
  }
}
