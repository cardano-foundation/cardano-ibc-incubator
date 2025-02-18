use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray.{from_int_big_endian}
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
  VerifyMembership, VerifyNonMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{TimeoutPacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnTimeoutPacket}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/validator_utils

validator timeout_packet(
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

    expect Some((datum, channel_redeemer, spent_output)) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect TimeoutPacket {
      packet,
      proof_unreceived,
      proof_height,
      next_sequence_recv,
    } = channel_redeemer

    trace @"timeout_packet: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState {
      channel: cur_channel,
      packet_commitment: cur_packet_commitment,
      ..
    } = cur_channel_state

    expect [connection_id] = cur_channel.connection_hops

    expect cur_channel.state == chan_state_mod.Open
    trace @"timeout_packet: channel state is open"

    let is_valid_packet = and {
        packet.source_port == port_id,
        packet.source_channel == channel_id,
        packet.destination_port == cur_channel.counterparty.port_id,
        packet.destination_channel == cur_channel.counterparty.channel_id,
      }
    trace @"timeout_packet: packet info matched channel state"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"timeout_packet: reference_inputs contain Connection utxo"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"timeout_packet: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"timeout_packet: client status is active"

    expect Some(proof_timestamp) =
      client_state_mod.get_timestamp_at_height(
        client_datum.state.client_state,
        client_datum.state.consensus_states,
        proof_height,
      )
    let valid_timestamp = or {
        !height_mod.is_zero(packet.timeout_height) && !(height_mod.compare(
          proof_height,
          packet.timeout_height,
        ) == Less),
        packet.timeout_timestamp != 0 && proof_timestamp >= packet.timeout_timestamp,
      }
    trace @"timeout_packet: packet is timeout"

    expect Some(commitment) =
      pairs.get_first(cur_packet_commitment, packet.sequence)
    trace @"timeout_packet: packet commitment existed"

    let valid_packet_timeout =
      when cur_channel.ordering is {
        chan_order_mod.Unordered ->
          validate_timeout_unordered_packet_proof(
            connection_datum.state,
            client_datum.state,
            proof_height,
            proof_unreceived,
            packet,
            redeemers,
            verify_proof_policy_id,
          )
        chan_order_mod.Ordered -> and {
            next_sequence_recv <= packet.sequence,
            validate_timeout_ordered_packet_proof(
              connection_datum.state,
              client_datum.state,
              proof_height,
              proof_unreceived,
              packet,
              next_sequence_recv,
              redeemers,
              verify_proof_policy_id,
            ),
          }
        _ -> False
      }

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect OnTimeoutPacket { channel_id: module_chan_id, .. } =
      ibc_module_callback
    trace @"timeout_packet: ibc module callback is valid"

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      is_valid_packet,
      valid_timestamp,
      channel_datum_mod.validate_timeout_packet(datum, updated_datum, packet),
      commitment == packet_mod.commit_packet(packet),
      module_chan_id == channel_id,
      valid_packet_timeout,
    }
  }

  else(_) {
    fail
  }
}

fn validate_timeout_unordered_packet_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof: MerkleProof,
  packet: Packet,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.packet_receipt_path(
            packet.destination_port,
            packet.destination_channel,
            packet.sequence,
          ),
        ],
      ),
    )
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  verify_proof_redeemer == VerifyNonMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path: merkle_path,
  }
}

fn validate_timeout_ordered_packet_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof: MerkleProof,
  packet: Packet,
  next_sequence_recv: Int,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          packet_keys.next_sequence_recv_path(
            packet.destination_port,
            packet.destination_channel,
          ),
        ],
      ),
    )
  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  verify_proof_redeemer == VerifyMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path: merkle_path,
    value: from_int_big_endian(next_sequence_recv, 8),
  }
}
