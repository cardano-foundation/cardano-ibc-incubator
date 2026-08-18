use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, Redeemer, ScriptPurpose, Transaction}
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
use ibc/core/ics_004/channel_redeemer.{RecvPacket}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnRecvPacket}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/validator_utils

validator recv_packet(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  mint(
    channel_token: AuthToken,
    recv_packet_policy_id: PolicyId,
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
        recv_packet_policy_id,
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

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    let channel_sequence = auth.extract_token_sequence(datum.token.name)
    trace @"recv_packet: datum.token.name": datum.token.name
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect RecvPacket { packet, proof_commitment, proof_height } =
      channel_redeemer

    trace @"recv_packet: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState {
      channel: cur_channel,
      packet_receipt: cur_packet_receipt,
      packet_acknowledgement: cur_packet_acknowledgement,
      // next_sequence_recv,
      ..
    } = cur_channel_state

    expect [connection_id] = cur_channel.connection_hops

    expect cur_channel.state == chan_state_mod.Open
    trace @"recv_packet: channel state is open"

    let (connection_datum, client_datum) =
      validator_utils.validate_referred_connection_and_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"recv_packet: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"recv_packet: Connection is open"
    trace @"recv_packet: validator_utils.validate_referred_client"

    let client_status =
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      )

    trace @"recv_packet: client status": client_status

    expect (client_status == client_status_mod.Active)?
    trace @"recv_packet: client status is active"

    let valid_packet_proof =
      validate_recv_packet_proof(
        connection_datum.state,
        client_datum.state,
        proof_height,
        proof_commitment,
        packet,
        redeemers,
        verify_proof_policy_id,
      )

    let module_redeemer =
      validator_utils.extract_packet_module_redeemer(
        inputs,
        reference_inputs,
        outputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
        host_state_nft_policy_id,
      )
    expect Callback(OnRecvPacket {
      channel_id: callback_channel_id,
      packet_data,
      acknowledgement,
      ..
    }) = module_redeemer
    expect and {
        callback_channel_id == channel_id,
        packet_data == packet.data,
      }
    let acknowledgement_bytes =
      acknowledgement_mod.acknowledgement(acknowledgement)
    let acknowledgement_commitment =
      acknowledgement_mod.commit_acknowledgement(acknowledgement_bytes)
    trace @"recv_packet: exact application callback matched"

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      packet_mod.validate_basic(packet)?,
      (packet.destination_port == port_id)?,
      (packet.destination_channel == channel_id)?,
      (packet.source_port == cur_channel.counterparty.port_id)?,
      (packet.source_channel == cur_channel.counterparty.channel_id)?,
      valid_packet_proof?,
      (!pairs.has_key(cur_packet_receipt, packet.sequence))?,
      (!pairs.has_key(cur_packet_acknowledgement, packet.sequence))?,
      // Cardano transaction contexts authenticate time through the validity
      // interval, but do not expose an authenticated destination block height.
      // Reject height timeouts until that height can be checked safely.
      height_mod.is_zero(packet.timeout_height)?,
      (packet.timeout_timestamp != 0)?,
      (tx_valid_to * 1_000_000 < packet.timeout_timestamp)?,
      channel_datum_mod.validate_recv_packet(
        datum,
        updated_datum,
        packet,
        acknowledgement_commitment,
      )?,
    }
  }

  else(_) {
    fail
  }
}

fn validate_recv_packet_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof: MerkleProof,
  packet: Packet,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let commitment = packet_mod.commit_packet(packet)

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_commitment_path(
            packet.source_port,
            packet.source_channel,
            packet.sequence,
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

  verify_proof_redeemer == VerifyMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    processed_time,
    processed_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path: merkle_path,
    value: commitment,
  }
}
