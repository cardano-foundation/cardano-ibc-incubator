use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Hash}
use aiken/int
use aiken/interval
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId, ValidityRange,
}
use aiken/transaction/credential.{Script}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/client as client_status
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, ChanOpenAck, ChanOpenConfirm, RecvPacket, RefreshUtxo,
  SendPacket, SpendChannelRedeemer, TimeoutPacket,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order as channel_order
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket, OnChanOpenAck, OnChanOpenConfirm,
  OnRecvPacket, OnTimeoutPacket, Operator, OtherModuleData, OtherModuleOperator
}
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, CommitmentProof_Nonexist,
  ExistenceProof, InnerOp, InnerSpec, LeafOp, NonExistenceProof, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  fn spend_channel(
    datum: ChannelDatum,
    redeemer: SpendChannelRedeemer,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction {
      outputs,
      reference_inputs,
      validity_range,
      inputs,
      redeemers,
      ..
    } = transaction

    expect auth.contain_auth_token(spent_output, datum.token)
    trace @"spend_channel: input contains auth token"

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)
    trace @"spend_channel: found updated output"

    expect auth.contain_auth_token(updated_output, datum.token)
    trace @"spend_channel: output contains auth token"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"spend_channel: extract tx valid_to"

    expect [connection_id] = datum.state.channel.connection_hops
    trace @"spend_channel: extract connection_id"

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = channel_keys.format_channel_identifier(channel_sequence)
    trace @"spend_channel: extract channel_id"

    when redeemer is {
      ChanOpenAck { counterparty_version, proof_try, proof_height } -> {
        trace @"spend_channel: ChanOpenAck branch"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo\n"

        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: Connection is open\n"

        expect [connection_version] = connection_datum.state.versions
        expect
          channel_order.string(datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"spend_channel: connection support channel ordering\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == client_status.Active
        trace @"spend_channel: client status is active\n"

        expect channel_datum_mod.is_channel_open_ack_valid(datum, updated_datum)
        trace @"spend_channel: output datum is updated valid\n"

        expect
          validate_chan_open_ack_proof(
            connection_datum.state,
            client_datum.state,
            channel_id,
            updated_datum,
            counterparty_version,
            proof_try,
            proof_height,
          )
        trace @"spend_channel: channel proof is valid\n"

        expect Some(ibc_module_redeemer) =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        expect ibc_module_callback == OnChanOpenAck { channel_id }
        trace @"spend_channel: ibc module callback is valid\n"

        True
      }
      ChanOpenConfirm { proof_ack, proof_height } -> {
        trace @"spend_channel: ChanOpenConfirm branch"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo\n"

        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: Connection is open\n"

        expect [connection_version] = connection_datum.state.versions
        expect
          channel_order.string(datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"spend_channel: connection support channel ordering\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == client_status.Active
        trace @"spend_channel: client status is active\n"

        expect
          channel_datum_mod.is_channel_open_confirm_valid(datum, updated_datum)
        trace @"spend_channel: output datum is updated valid\n"

        expect
          validate_chan_open_confirm_proof(
            connection_datum.state,
            client_datum.state,
            channel_id,
            updated_datum,
            proof_ack,
            proof_height,
          )
        trace @"spend_channel: channel proof is valid\n"

        expect Some(ibc_module_redeemer) =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        expect ibc_module_callback == OnChanOpenConfirm { channel_id }
        trace @"spend_channel: ibc module callback is valid\n"

        True
      }
      RecvPacket { packet, proof_commitment, proof_height } -> {
        trace @"spend_channel: RecvPacket branch"

        let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
        let ChannelDatumState {
          channel: cur_channel,
          packet_receipt: cur_packet_receipt,
          packet_acknowledgement: cur_packet_acknowledgement,
          next_sequence_recv,
          ..
        } = cur_channel_state

        expect packet_mod.validate_basic(packet)
        trace @"spend_channel: packet validated basic"

        expect
          packet.destination_port == port_id && packet.destination_channel == channel_id
        expect
          packet.source_port == cur_channel.counterparty.port_id && packet.source_channel == cur_channel.counterparty.channel_id
        trace @"spend_channel: packet ports and channels matched"

        expect cur_channel.state == channel_state.Open
        trace @"spend_channel: channel state is open"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo"
        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: Connection is open"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == client_status.Active
        trace @"spend_channel: client status is active"

        expect
          packet.timeout_timestamp != 0 && tx_valid_to * 1_000_000 < packet.timeout_timestamp
        trace @"spend_channel: packet timeout_timestamp is not over"

        expect
          validate_recv_packet_proof(
            connection_datum.state,
            client_datum.state,
            proof_height,
            proof_commitment,
            packet,
          )
        trace @"spend_channel: packet proof is valid"

        expect Some(ibc_module_redeemer) =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        expect OnRecvPacket {
          channel_id: module_chan_id,
          acknowledgement,
          data: _,
        } = ibc_module_callback
        expect module_chan_id == channel_id
        trace @"spend_channel: ibc module callback is valid"

        expect
          when cur_channel.ordering is {
            channel_order.Unordered -> {
              trace @"spend_channel: channel ordering is  Unordered"

              expect
                (
                  dict.from_list(cur_packet_receipt, int.compare)
                    |> dict.has_key(packet.sequence)
                ) == False
              trace @"spend_channel: packet not relayed yet"

              True
            }
            channel_order.Ordered -> {
              trace @"spend_channel: channel ordering is  Ordered"

              expect packet.sequence == next_sequence_recv
              trace @"spend_channel: packet sequence match next sequence recv"

              True
            }
            _ -> {
              trace @"spend_channel: other channel order"
              False
            }
          }

        expect
          (
            dict.from_list(cur_packet_acknowledgement, int.compare)
              |> dict.has_key(packet.sequence)
          ) == False
        trace @"spend_channel: acknowledgement not relayed yet"

        let bz_ack = acknowledgement_mod.acknowledgement(acknowledgement)
        let commit_ack = acknowledgement_mod.commit_acknowledgement(bz_ack)

        expect
          channel_datum_mod.validate_recv_packet(
            datum,
            updated_datum,
            packet,
            commit_ack,
          )
        trace @"spend_channel: channel datum is updated valid"

        True
      }
      SendPacket { packet } -> {
        trace @"spend_channel: SendPacket branch"

        let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
        let ChannelDatumState { channel: cur_channel, next_sequence_send, .. } =
          cur_channel_state

        expect cur_channel.state == channel_state.Open
        trace @"spend_channel: channel state is open"

        expect packet_mod.validate_basic(packet)
        trace @"spend_channel: packet validated basic"

        expect and {
            packet.source_port == port_id,
            packet.source_channel == channel_id,
            packet.destination_port == cur_channel.counterparty.port_id,
            packet.destination_channel == cur_channel.counterparty.channel_id,
            packet.sequence == next_sequence_send,
          }
        trace @"spend_channel: packet info matched channel state"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: reference_inputs contain Client utxo"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == client_status.Active
        trace @"spend_channel: client status is active"

        let latest_height =
          client_state.get_latest_height(client_datum.state.client_state)
        expect
          height_mod.is_zero(packet.timeout_height) || height_mod.compare(
            latest_height,
            packet.timeout_height,
          ) == Less
        trace @"spend_channel: packet timeout_height is not over"

        expect Some(latest_timestamp) =
          client_state.get_timestamp_at_height(
            client_datum.state.client_state,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
            latest_height,
          )
        expect
          packet.timeout_timestamp == 0 || latest_timestamp < packet.timeout_timestamp
        trace @"spend_channel: packet timeout_timestamp is not over"

        let commitment = packet_mod.commit_packet(packet)

        expect
          channel_datum_mod.validate_send_packet(
            datum,
            updated_datum,
            packet,
            commitment,
          )
        trace @"spend_channel: channel_datum is updated valid"

        expect Some(ibc_module_redeemer) =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            datum.token.name,
            port_minting_policy_id,
            datum.port_id,
          )
        expect Operator(_) = ibc_module_redeemer
        trace @"spend_channel: tx spends module utxo"

        True
      }
      TimeoutPacket {
        packet,
        proof_unreceived,
        proof_height,
        next_sequence_recv,
      } -> {
        trace @"spend_channel: TimeoutPacket branch"

        let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
        let ChannelDatumState {
          channel: cur_channel,
          packet_commitment: cur_packet_commitment,
          ..
        } = cur_channel_state

        expect cur_channel.state == channel_state.Open
        trace @"spend_channel: channel state is open"

        expect and {
            packet.source_port == port_id,
            packet.source_channel == channel_id,
            packet.destination_port == cur_channel.counterparty.port_id,
            packet.destination_channel == cur_channel.counterparty.channel_id,
          }
        trace @"spend_channel: packet info matched channel state"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: reference_inputs contain Client utxo"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == client_status.Active
        trace @"spend_channel: client status is active"

        expect Some(proof_timestamp) =
          client_state.get_timestamp_at_height(
            client_datum.state.client_state,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
            proof_height,
          )
        expect or {
            !height_mod.is_zero(packet.timeout_height) && !(height_mod.compare(
              proof_height,
              packet.timeout_height,
            ) == Less),
            packet.timeout_timestamp != 0 && proof_timestamp >= packet.timeout_timestamp,
          }
        trace @"spend_channel: packet is timeout"

        expect Some(commitment) =
          dict.from_list(cur_packet_commitment, int.compare)
            |> dict.get(packet.sequence)
        trace @"spend_channel: packet commitment existed"

        let packet_commitment = packet_mod.commit_packet(packet)
        expect commitment == packet_commitment
        trace @"spend_channel: timeout packet match commit packet"

        expect
          when cur_channel.ordering is {
            channel_order.Unordered -> {
              trace @"spend_channel: channel ordering is  Unordered"

              expect
                verify.verify_packet_receipt_absence(
                  client_datum.state,
                  connection_datum.state,
                  proof_height,
                  proof_unreceived,
                  packet.destination_port,
                  packet.destination_channel,
                  packet.sequence,
                )
              trace @"spend_channel: packet proof is valid"

              True
            }
            channel_order.Ordered -> {
              trace @"spend_channel: channel ordering is not Unordered"

              expect next_sequence_recv <= packet.sequence
              trace @"spend_channel: packet not received yet"

              expect
                verify.verify_next_sequence_recv(
                  client_datum.state,
                  connection_datum.state,
                  proof_height,
                  proof_unreceived,
                  packet.destination_port,
                  packet.destination_channel,
                  next_sequence_recv,
                )
              trace @"spend_channel: packet proof is valid"

              True
            }
            _ -> False
          }

        expect
          channel_datum_mod.validate_timeout_packet(
            datum,
            updated_datum,
            packet,
          )
        trace @"spend_channel: channel datum is updated valid"

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
        expect module_chan_id == channel_id
        trace @"spend_channel: ibc module callback is valid"

        True
      }
      AcknowledgePacket { packet, acknowledgement, proof_acked, proof_height } -> {
        trace @"spend_channel: AcknowledgePacket branch"

        let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
        let ChannelDatumState {
          channel: cur_channel,
          packet_commitment: cur_packet_commitment,
          next_sequence_ack,
          ..
        } = cur_channel_state

        expect cur_channel.state == channel_state.Open
        trace @"spend_channel: channel state is open"

        expect and {
            packet.source_port == port_id,
            packet.source_channel == channel_id,
            packet.destination_port == cur_channel.counterparty.port_id,
            packet.destination_channel == cur_channel.counterparty.channel_id,
          }
        trace @"spend_channel: packet info matched channel state"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"spend_channel: reference_inputs contain Connection utxo"

        expect connection_datum.state.state == connection_state.Open
        trace @"spend_channel: connection state is open"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"spend_channel: reference_inputs contain Client utxo"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            dict.from_list(
              client_datum.state.consensus_states,
              height_mod.compare,
            ),
          ) == client_status.Active
        trace @"spend_channel: client status is active"

        expect Some(commitment) =
          dict.from_list(cur_packet_commitment, int.compare)
            |> dict.get(packet.sequence)
        trace @"spend_channel: packet commitment existed"

        let packet_commitment = packet_mod.commit_packet(packet)
        expect commitment == packet_commitment
        trace @"spend_channel: ack packet match commit packet"

        expect
          verify.verify_packet_acknowledgement(
            client_datum.state,
            connection_datum.state,
            proof_height,
            proof_acked,
            packet.destination_port,
            packet.destination_channel,
            packet.sequence,
            acknowledgement,
          )
        trace @"spend_channel: packet proof is valid"

        expect cur_channel.ordering != channel_order.Ordered || {
            expect packet.sequence == next_sequence_ack
            trace @"spend_channel: packet sequence matched next_sequence_ack"
            True
          }

        expect
          channel_datum_mod.validate_acknowledge_packet(
            datum,
            updated_datum,
            packet,
          )
        trace @"spend_channel: channel datum is updated valid"

        expect Some(ibc_module_redeemer) =
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
        expect module_chan_id == channel_id
        trace @"spend_channel: ibc module callback is valid\n"

        True
      }
      RefreshUtxo -> {
        trace @"spend_channel: RefreshUtxo branch"

        expect channel_datum_mod.validate_refresh_utxo(datum, updated_datum)
        trace @"spend_channel: channel datum is updated valid"

        True
      }
    }
  }
}

fn validate_chan_open_ack_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  counterparty_version: ByteArray,
  proof_try: MerkleProof,
  proof_height: Height,
) -> Bool {
  let counterparty_hops =
    [connection_end.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: channel_state.TryOpen,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: counterparty_version,
    }

  verify.verify_channel_state(
    client_datum_state,
    connection_end,
    channel_datum.state.channel.counterparty.port_id,
    channel_datum.state.channel.counterparty.channel_id,
    proof_try,
    proof_height,
    expected_channel,
  )
}

fn validate_chan_open_confirm_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  proof_ack: MerkleProof,
  proof_height: Height,
) -> Bool {
  let counterparty_hops =
    [connection_end.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: channel_datum.state.channel.version,
    }

  verify.verify_channel_state(
    client_datum_state,
    connection_end,
    channel_datum.state.channel.counterparty.port_id,
    channel_datum.state.channel.counterparty.channel_id,
    proof_ack,
    proof_height,
    expected_channel,
  )
}

fn validate_recv_packet_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  proof_height: Height,
  proof_commitment: MerkleProof,
  packet: Packet,
) -> Bool {
  let commitment = packet_mod.commit_packet(packet)

  expect
    verify.verify_packet_commitment(
      client_datum_state,
      connection_end,
      proof_height,
      proof_commitment,
      packet.source_port,
      packet.source_channel,
      packet.sequence,
      commitment,
    )

  True
}

//==========================================Test================================================

type MockData {
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_minting_policy_id: PolicyId,
  channel_sequence: Int,
  channel_token: AuthToken,
  handler_token: AuthToken,
  connection_id: ByteArray,
  connection_input: Input,
  client_input: Input,
  validity_range: ValidityRange,
  port_id: ByteArray,
  module_input: Input,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  //========================Channel============================
  let channel_sequence = 0
  let channel_minting_policy_id = "mock channel_minting_policy_id"

  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      channel_keys.channel_prefix,
      channel_sequence,
    )
  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  //========================Connection============================
  let connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
        client_id: "ibc_client-10",
        versions: [
          Version {
            identifier: "1",
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        state: connection_state.Open,
        counterparty: Counterparty {
          client_id: "07-tendermint-0",
          connection_id: "connection-0",
          prefix: MerklePrefix { key_prefix: "ibc" },
        },
        delay_period: 0,
      },
      token: AuthToken { name: "", policy_id: "" },
    }

  let connection_id = "connection-134"

  let connection_sequence =
    conn_keys_mod.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name(
      handler_token,
      conn_keys_mod.connection_prefix,
      connection_sequence,
    )

  let connection_minting_policy_id = "mock connection_minting_policy_id"

  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: connection_token_name,
    }

  let connection_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "tx_hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("mock connection script hash"),
        value: value.from_asset(
          connection_token.policy_id,
          connection_token.name,
          1,
        ),
        datum: InlineDatum(connection_datum),
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

  let trust_level = unchecked_rational.new(1, 3)

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
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: Height { revision_number: 1, revision_height: 13 },
      proof_specs,
    }

  let client_sequence =
    client_keys_mod.parse_client_id_sequence(connection_datum.state.client_id)

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

  //==========================Module===========================
  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_id = "port-1"
  let port_number = port_keys_mod.parse_port_id_number(port_id)
  let port_token_name =
    auth.generate_token_name(
      handler_token,
      port_keys_mod.port_prefix,
      port_number,
    )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "mock module tx hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("mock module script hash"),
        value: value.from_asset(port_token.policy_id, port_token.name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  MockData {
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    spend_channel_script_hash: "mock spend_channel_script_hash",
    channel_minting_policy_id,
    channel_sequence,
    channel_token,
    handler_token,
    connection_id,
    connection_input,
    client_input,
    validity_range,
    port_id,
    module_input,
  }
}

fn build_channel_output(
  channel_datum: ChannelDatum,
  channel_token: AuthToken,
) -> Output {
  let channel_output =
    Output {
      address: credential.from_script("mock spend channel script hash"),
      value: value.from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(channel_datum),
      reference_script: None,
    }

  channel_output
}

fn build_channel_input(
  channel_datum: ChannelDatum,
  channel_token: AuthToken,
) -> Input {
  let channel_output = build_channel_output(channel_datum, channel_token)

  let channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "mock spent channel tx hash" },
        output_index: 0,
      },
      output: channel_output,
    }

  channel_input
}

fn update_client(
  height: Height,
  consensus_state: ConsensusState,
  client_input: Input,
) -> Input {
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)

  let latest_height = {
    let input_height =
      client_state.get_latest_height(client_datum.state.client_state)
    if height_mod.compare(height, input_height) == Greater {
      height
    } else {
      input_height
    }
  }

  let client_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        client_state: ClientState {
          ..client_datum.state.client_state,
          latest_height: latest_height,
        },
        consensus_states: dict.from_list(
          client_datum.state.consensus_states,
          height_mod.compare,
        )
          |> dict.insert(height, consensus_state, height_mod.compare)
          |> dict.to_list(),
      },
    }

  let updated_input =
    Input {
      ..client_input,
      output: Output { ..client_input.output, datum: InlineDatum(client_datum) },
    }

  updated_input
}

fn send_packet(packet: Packet, channel_datum: ChannelDatum) -> ChannelDatum {
  expect packet.sequence == channel_datum.state.next_sequence_send

  let commitment = packet_mod.commit_packet(packet)

  ChannelDatum {
    ..channel_datum,
    state: ChannelDatumState {
      ..channel_datum.state,
      next_sequence_send: channel_datum.state.next_sequence_send + 1,
      packet_commitment: dict.from_list(
        channel_datum.state.packet_commitment,
        int.compare,
      )
        |> dict.insert(packet.sequence, commitment, int.compare)
        |> dict.to_list(),
    },
  }
}

test succeed_chan_open_ack() {
  let mock_data = setup()

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: channel_state.Init,
      ordering: channel_order.Ordered,
      counterparty: ChannelCounterparty { port_id: "port-1", channel_id: "" },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 14 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"f184766fc80a33423ebdb0c94b9e1200995204d84b4527e48d49a62e556d719e",
      root: MerkleRoot {
        hash: #"a87ef44a0eaf1770ec5b89029afd80ac1c46bc42c94c3daafcc9b45b9fd021d1",
      },
    }

  let client_input =
    update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let output_channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_order.Ordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let output_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: output_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_output =
    build_channel_output(output_channel_datum, mock_data.channel_token)

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_try =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"6368616e6e656c456e64732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d30",
              value: #"080210021a130a06706f72742d3112096368616e6e656c2d30220c636f6e6e656374696f6e2d302a0c6d6f636b2d76657273696f6e",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00021a",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02041a20",
                  suffix: #"20072452876773f4e9b67456f4fd55fe48c9492aa788251556eab0975eb57ac2ca",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04081a20",
                  suffix: #"20d37e05016b4cd45e7e0454178e811a7b2b53f7092387ae95383a3b7fcdd39092",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060e1a20",
                  suffix: #"20d27ed71739a2421431b123e9154cee8cfcc27f08cbff5ad8c405452229870bb2",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08181a20",
                  suffix: #"20406bc53ced9da540989fc85e1dbd662b4076abf82f3188c0318cb65028d7eb37",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c3c1a20",
                  suffix: #"200691f65010caeb9e5cfc62a8a60a80a8ffbc07a6a2c5dfc2a725512411bbd091",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"7020ef1e10a4625f68ad8d581f940051c413d2e2d95764b215767e66d1c3a4d8",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0159cd7e1a11b0e9e8cef7773569a5efa2cc01ee93fe6e09e0e4cbb3e434bb614c",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"1f55e6131b22078945a0cb93c65fe5fef6d4a361a4a573c00e4d1d02b476040f",
                },
              ],
            },
          },
        },
      ],
    }
  let counterparty_version = "mock-version"

  let spend_channel_redeemer =
    ChanOpenAck { counterparty_version, proof_try, proof_height }

  let channel_id =
    channel_keys.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer = Callback(OnChanOpenAck { channel_id })

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
           Spend(mock_data.module_input.output_reference),
           module_redeemer,
           validator_utils.compare_script_purpose,
         )
      |> dict.insert(
           Spend(channel_input.output_reference),
           spend_channel_redeemer,
           validator_utils.compare_script_purpose,
         )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    input_channel_datum,
    spend_channel_redeemer,
    context,
  )
}

test succeed_chan_open_confirm() {
  let mock_data = setup()

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: channel_state.TryOpen,
      ordering: channel_order.Ordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 16 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"40bac4308c74536ab0cc30b6969709a99d05da780e66abd850dac743ccc1cfe0",
      root: MerkleRoot {
        hash: #"20a0aa74029d202ed97a3e41da4b70db1deaafddf2b3b9066d865338ce99811e",
      },
    }

  let client_input =
    update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        channel: Channel {
          ..input_channel_datum.state.channel,
          state: channel_state.Open,
        },
      },
    }

  let channel_output =
    build_channel_output(output_channel_datum, mock_data.channel_token)

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_ack =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"6368616e6e656c456e64732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d30",
              value: #"080310021a130a06706f72742d3112096368616e6e656c2d30220c636f6e6e656374696f6e2d302a0c6d6f636b2d76657273696f6e",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00021e",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02041e20",
                  suffix: #"20072452876773f4e9b67456f4fd55fe48c9492aa788251556eab0975eb57ac2ca",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04061e20",
                  suffix: #"20e7ec6e1776b5db1c8b71fe184c6606c71919fb9a382649d76f35d58f76701b97",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060a1e20",
                  suffix: #"208e22b3b6977bd71afbc25d3a61c0f6a2c62f2d1377202de31abec96298257b5d",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a1c1e20",
                  suffix: #"207d5db3f115b0cc58b406afe3f19cb4251f91868e39377385fd0bb77753d4e3b8",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c3c1e20",
                  suffix: #"20efc9265781c6af9c0ba92b52f4c24f96abe210922494080323e37605b2fc60c9",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"45d813a49f7c1ba21df4d91a652db5ea4c803daedd9a07c71fee7af03bbdc8ff",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"016ef3f9177b708d4ce3e986afb54124ad3bb04ca44d3d764dd5d46908fd95654e",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"149725dcc602044e4c89622890eeea53e0f8b60870a52865da74d3c5f84e41c3",
                },
              ],
            },
          },
        },
      ],
    }

  let spend_channel_redeemer = ChanOpenConfirm { proof_ack, proof_height }

  let channel_id =
    channel_keys.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer = Callback(OnChanOpenConfirm { channel_id })

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
           Spend(mock_data.module_input.output_reference),
           module_redeemer,
           validator_utils.compare_script_purpose,
         )
      |> dict.insert(
           Spend(channel_input.output_reference),
           spend_channel_redeemer,
           validator_utils.compare_script_purpose,
         )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    input_channel_datum,
    spend_channel_redeemer,
    context,
  )
}

test succeed_recv_packet() {
  let mock_data = setup()

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_order.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 19 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"7c3af87e2c224be7f3b2d7b2ab467e69b1a4ef5947fbe76d55e9091e16172346",
      root: MerkleRoot {
        hash: #"11a648b10463e8a96c77976940ee316117bb8214bd380e267aa31cf39ef8a09a",
      },
    }

  let client_input =
    update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let ack = acknowledgement_mod.new_result_acknowledgement(#"01")
  let bz_ack = acknowledgement_mod.acknowledgement(ack)
  let commit_ack = acknowledgement_mod.commit_acknowledgement(bz_ack)

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1735689600000000000,
    }

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_receipt: dict.from_list(
          input_channel_datum.state.packet_receipt,
          int.compare,
        )
          |> dict.insert(packet.sequence, "", int.compare)
          |> dict.to_list(),
        packet_acknowledgement: dict.from_list(
          input_channel_datum.state.packet_acknowledgement,
          int.compare,
        )
          |> dict.insert(packet.sequence, commit_ack, int.compare)
          |> dict.to_list(),
      },
    }

  let channel_output =
    build_channel_output(output_channel_datum, mock_data.channel_token)

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_commitment =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"636f6d6d69746d656e74732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
              value: #"fa365cf5deedf3169bfe56010f101be23eac638d3bc9f43c7634f78ef718aa10",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"000224",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"020424205fd25b3dc1314970dcbf74075f9d165af4a185eea459128edf21cfacc14b9c9e20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04062420",
                  suffix: #"2067b76c7b82d60ebee7f41dd11a02534c1a16efa70c217310356230dfd5ad0c20",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060a2420",
                  suffix: #"20f21e95601cbd0028a9c3c4effd8afbbe068f086ab152ec0edb9cde2fdd6c568f",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08162420",
                  suffix: #"2038afa1cc8688eedde1256daab2bff7aade39a6db7320d62f47581fb65d9e8024",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a2424203dd3101284b12a1c86ec48897aaf11781985de6f1eb75fdb6c8011a7d3e4d2ad20",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c462420617a9deebfac19d019bc9f7179c90ed228ee21d7330bc10568918f6f26cbb75320",
                  suffix: #"",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"6cfc3a7872f9703bcd5027ba7197890652bf545bd77a4ae7fa8b780746c91e42",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01ef0d5a163ae333b43e2956b2d9660e65aaa9a1e2f90b30a91d97b5d0f12fb1fc",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"04634f3eedce1a4677cef6f418f7671437db345ad7e26581393b7cc6e722a2c7",
                },
              ],
            },
          },
        },
      ],
    }

  let spend_channel_redeemer =
    RecvPacket { packet, proof_commitment, proof_height }

  let channel_id =
    channel_keys.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnRecvPacket { channel_id, acknowledgement: ack, data: OtherModuleData },
    )

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
           Spend(mock_data.module_input.output_reference),
           module_redeemer,
           validator_utils.compare_script_purpose,
         )
      |> dict.insert(
           Spend(channel_input.output_reference),
           spend_channel_redeemer,
           validator_utils.compare_script_purpose,
         )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    input_channel_datum,
    spend_channel_redeemer,
    context,
  )
}

test succeed_send_packet() {
  let mock_data = setup()

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1735689600000000000,
    }

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_order.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: packet.sequence,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  // let proof_height = Height { revision_number: 1, revision_height: 19 }
  // let cons_state =
  //   ConsensusState {
  //     timestamp: 1577923295000000000,
  //     next_validators_hash: #"7c3af87e2c224be7f3b2d7b2ab467e69b1a4ef5947fbe76d55e9091e16172346",
  //     root: MerkleRoot {
  //       hash: #"11a648b10463e8a96c77976940ee316117bb8214bd380e267aa31cf39ef8a09a",
  //     },
  //   }
  // let client_input =
  //   update_client(proof_height, cons_state, mock_data.client_input)
  let reference_inputs =
    [mock_data.connection_input, mock_data.client_input]

  //========================arrange outputs=======================
  let commitment = packet_mod.commit_packet(packet)

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        next_sequence_send: input_channel_datum.state.next_sequence_send + 1,
        packet_commitment: dict.from_list(
          input_channel_datum.state.packet_commitment,
          int.compare,
        )
          |> dict.insert(packet.sequence, commitment, int.compare)
          |> dict.to_list(),
      },
    }

  let channel_output =
    build_channel_output(output_channel_datum, mock_data.channel_token)

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let spend_channel_redeemer = SendPacket { packet }

  let module_redeemer: Redeemer = Operator(OtherModuleOperator)

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
           Spend(mock_data.module_input.output_reference),
           module_redeemer,
           validator_utils.compare_script_purpose,
         )
      |> dict.insert(
           Spend(channel_input.output_reference),
           spend_channel_redeemer,
           validator_utils.compare_script_purpose,
         )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    input_channel_datum,
    spend_channel_redeemer,
    context,
  )
}

test succeed_timeout_packet() {
  let mock_data = setup()

  let pack_timeout_height = Height { revision_number: 1, revision_height: 18 }

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: pack_timeout_height,
      timeout_timestamp: 0,
    }

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_order.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let input_channel_datum = send_packet(packet, input_channel_datum)

  let channel_input =
    build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height =
    Height {
      ..pack_timeout_height,
      revision_height: pack_timeout_height.revision_height + 1,
    }

  let cons_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"020402703976bb4e91f05e69c25627e1b813bfeca54f4825afee49efe8acdbd7",
      root: MerkleRoot {
        hash: #"2a2a5880ec8d4d978eaace39e4d256a7d1dbd024f3c471aa8fa14a955d3eb102",
      },
    }

  let client_input =
    update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_commitment: dict.from_list(
          input_channel_datum.state.packet_commitment,
          int.compare,
        )
          |> dict.delete(packet.sequence)
          |> dict.to_list(),
      },
    }

  let channel_output =
    build_channel_output(output_channel_datum, mock_data.channel_token)

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_unreceived =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Nonexist {
            non_exist: NonExistenceProof {
              key: #"72656365697074732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
              left: ExistenceProof {
                key: #"6e65787453657175656e636553656e642f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d30",
                value: #"0000000000000001",
                leaf: LeafOp {
                  hash: 1,
                  prehash_value: 1,
                  length: 1,
                  prefix: #"00021a",
                  prehash_key: 0,
                },
                path: [
                  InnerOp {
                    hash: 1,
                    prefix: #"02041a2069fe4c2aa5110a8a5c97f267c34267d36f7ba2cf991cf3fd3624660aee2e746b20",
                    suffix: #"",
                  },
                  InnerOp {
                    hash: 1,
                    prefix: #"04081a20ae5dc2363c0f0d1336872b4849c4e7a2041e3c3fec05c0337ab5cf34310a591820",
                    suffix: #"",
                  },
                  InnerOp {
                    hash: 1,
                    prefix: #"060c1a2094ccea99bc1c0dfeb3076d2e23d97768e40ce76732c03fef3e4d4294f86bab3e20",
                    suffix: #"",
                  },
                  InnerOp {
                    hash: 1,
                    prefix: #"08142420408185c9c7a64d80e582a667d4c43c4c75f6f70b31973c1cc9566949f2ff4c4a20",
                    suffix: #"",
                  },
                  InnerOp {
                    hash: 1,
                    suffix: #"",
                    prefix: #"0a282420fe7b9f8701623b31b2cd0081bc29eeb8d8820342762d2291f99d0b87c45d2dad20",
                  },
                  InnerOp {
                    hash: 1,
                    suffix: #"",
                    prefix: #"0c4c242042ffb12ab52829ebe99314eb358efc1cb2c0c9bc351c26f1e8807cff1a0ab46d20",
                  },
                ],
              },
              right: ExistenceProof {
                key: #"",
                value: #"",
                leaf: LeafOp {
                  hash: 0,
                  prehash_key: 0,
                  prehash_value: 0,
                  length: 0,
                  prefix: #"",
                },
                path: [],
              },
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"61ab6bc2f730e4b47b25ecbd63b19016dbbed90882db668aa9b904e4dc440b48",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"011ff6dd57644f3deb80dc6cf90b299a9d3b524446c6c939887fbe332ec5cf001a",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"1eac9a45c80ab2a8e4cf596213fe46583ee60b37ae47a49bb801d487f22cb301",
                },
              ],
            },
          },
        },
      ],
    }

  let spend_channel_redeemer =
    TimeoutPacket {
      packet,
      proof_unreceived,
      proof_height,
      next_sequence_recv: 0,
    }

  let channel_id =
    channel_keys.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnTimeoutPacket { channel_id, data: OtherModuleData },
    )

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
           Spend(mock_data.module_input.output_reference),
           module_redeemer,
           validator_utils.compare_script_purpose,
         )
      |> dict.insert(
           Spend(channel_input.output_reference),
           spend_channel_redeemer,
           validator_utils.compare_script_purpose,
         )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    input_channel_datum,
    spend_channel_redeemer,
    context,
  )
}

test succeed_acknowledge_packet() {
  let mock_data = setup()

  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: "mock packet data",
      timeout_height: Height { revision_number: 1, revision_height: 100 },
      timeout_timestamp: 0,
    }

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: channel_state.Open,
      ordering: channel_order.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let input_channel_datum = send_packet(packet, input_channel_datum)

  let channel_input =
    build_channel_input(input_channel_datum, mock_data.channel_token)

  let inputs =
    [mock_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 20 }

  let cons_state =
    ConsensusState {
      timestamp: 1577923365000000000,
      next_validators_hash: #"2995675ed1313a1c80f6f4444ffc859bb9f00f71b75d6ca23481ca8d70691907",
      root: MerkleRoot {
        hash: #"b06efe83ef60f9b969917fa26c392eec29cdbfb6e6d11007c57856a412ff0997",
      },
    }

  let client_input =
    update_client(proof_height, cons_state, mock_data.client_input)

  let reference_inputs =
    [mock_data.connection_input, client_input]

  //========================arrange outputs=======================
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        packet_commitment: dict.from_list(
          input_channel_datum.state.packet_commitment,
          int.compare,
        )
          |> dict.delete(packet.sequence)
          |> dict.to_list(),
      },
    }

  let channel_output =
    build_channel_output(output_channel_datum, mock_data.channel_token)

  let outputs =
    [channel_output]

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_acked =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"61636b732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d302f73657175656e6365732f31",
              value: #"8c9178e2ad2afc8d7ccfd8488d1772bf5608cd6b9be915ff2be4e7464260e188",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"000226",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02042620",
                  suffix: #"204d198d6f3ec3241b254b936a97b1169840a51927a724e86bc74768d61c54dae1",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04062620",
                  suffix: #"20072452876773f4e9b67456f4fd55fe48c9492aa788251556eab0975eb57ac2ca",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060a2620",
                  suffix: #"20878870a2a00fe59306a9305b0024c2ea2f8aefec42e0e08fc70793c5a0eda3fc",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08102620",
                  suffix: #"2081c1bbc422016996a2b745a9ac317313d4910afc70c38b08b381326770ba4634",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0a262620",
                  suffix: #"207917684c7c65d6789004e264adf6733c969d918b5410bfb7d2ac9b64ea65fe5a",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c502620",
                  suffix: #"20485d70d4a8f04c6b269b5f53257a9f7593c6ce2f3bb45e668538472aecc50685",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"951d596e30a9ff634520dcd1f02fafb1eb97ee4379aa1ea054aa6890de30014e",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"018231ef82a7d9af2deff46bf6b14229163c2bcb013bc12f4188243420db5af65e",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"9ea341b458ca3d49dbaffd8459b0da393b46fd3261b9aea6f165b31811df10b7",
                },
              ],
            },
          },
        },
      ],
    }

  let spend_channel_redeemer =
    AcknowledgePacket {
      packet,
      proof_acked,
      proof_height,
      acknowledgement: #"7b22726573756c74223a226257396a6179426859327475623364735a57526e5a57316c626e513d227d",
    }

  let channel_id =
    channel_keys.format_channel_identifier(mock_data.channel_sequence)
  let module_redeemer: Redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id,
        data: OtherModuleData,
        acknowledgement: acknowledgement_mod.new_result_acknowledgement(#"01"),
      },
    )

  let redeemers: Dict<ScriptPurpose, Redeemer> =
    dict.new()
      |> dict.insert(
           Spend(mock_data.module_input.output_reference),
           module_redeemer,
           validator_utils.compare_script_purpose,
         )
      |> dict.insert(
           Spend(channel_input.output_reference),
           spend_channel_redeemer,
           validator_utils.compare_script_purpose,
         )

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  spend_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    input_channel_datum,
    spend_channel_redeemer,
    context,
  )
}
