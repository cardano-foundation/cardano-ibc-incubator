use aiken/cbor
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/address
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{
  Input, Output, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum} as channel_datum
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, PrunePacketHistory, RecvPacket, SendPacket,
  SpendChannelRedeemer, TimeoutPacket,
}
use ibc/core/ics_004/types/keys as channel_id_keys
use ibc/core/ics_004/types/order.{Ordered}
use ibc/core/ics_004/types/packet
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HandlePacket, HostStateRedeemer,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizePacket, LifecyclePacketMarkerRedeemer, lifecycle_marker_token_name,
}
use ibc/utils/validator_utils

fn host_thread(
  inputs: List<Input>,
  outputs: List<Output>,
  host_policy: PolicyId,
) -> (Input, Output, HostStateDatum, HostStateDatum) {
  let token = AuthToken { policy_id: host_policy, name: host_state_token_name }
  expect [host_input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, token) },
    )
  expect [host_output] =
    list.filter(outputs, fn(output) { auth.contain_auth_token(output, token) })
  expect host_output.address == host_input.output.address
  expect old: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  expect new: HostStateDatum = validator_utils.get_inline_datum(host_output)
  expect old.nft_policy == host_policy
  expect new.nft_policy == host_policy
  (host_input, host_output, old, new)
}

fn inputs_with_policy(inputs: List<Input>, policy: PolicyId) -> List<Input> {
  list.filter(
    inputs,
    fn(input) { !(input.output.value |> tokens(policy) |> dict.is_empty) },
  )
}

fn outputs_with_policy(outputs: List<Output>, policy: PolicyId) -> List<Output> {
  list.filter(
    outputs,
    fn(output) { !(output.value |> tokens(policy) |> dict.is_empty) },
  )
}

fn canonical_token(output: Output, policy: PolicyId) -> AuthToken {
  expect [Pair(name, 1)] = output.value |> tokens(policy) |> dict.to_pairs
  AuthToken { policy_id: policy, name }
}

fn channel_id(token_name: ByteArray) -> ByteArray {
  auth.extract_token_sequence(token_name)
    |> channel_id_keys.format_channel_identifier
}

fn channel_thread(
  inputs: List<Input>,
  outputs: List<Output>,
  policy: PolicyId,
  script_hash: Hash<Blake2b_224, Script>,
) -> (Input, ChannelDatum, ChannelDatum) {
  expect [input] = inputs_with_policy(inputs, policy)
  expect [output] = outputs_with_policy(outputs, policy)
  let token = canonical_token(input.output, policy)
  expect canonical_token(output, policy) == token
  expect input.output.address.payment_credential == address.Script(script_hash)
  expect output.address == input.output.address
  expect input_datum: ChannelDatum =
    validator_utils.get_inline_datum(input.output)
  expect output_datum: ChannelDatum = validator_utils.get_inline_datum(output)
  expect input_datum.token == token
  expect output_datum.token == token
  expect auth.contains_only_auth_tokens(output, [token])
  (input, input_datum, output_datum)
}

fn delete_packet_commitment(
  root: ByteArray,
  datum: ChannelDatum,
  port_id: ByteArray,
  channel_id: ByteArray,
  sequence: Int,
  siblings: List<ByteArray>,
) -> ByteArray {
  expect Some(commitment) =
    pairs.get_first(datum.state.packet_commitment, sequence)
  ibc_state_commitment.apply_update(
    root,
    packet_keys.packet_commitment_path(port_id, channel_id, sequence),
    cbor.serialise(commitment),
    "",
    siblings,
  )
}

fn validate_handle_packet(
  old: HostStateDatum,
  new: HostStateDatum,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  policy: PolicyId,
  script_hash: Hash<Blake2b_224, Script>,
  channel_siblings: List<ByteArray>,
  send_siblings: List<ByteArray>,
  recv_siblings: List<ByteArray>,
  ack_siblings: List<ByteArray>,
  commitment_siblings: List<ByteArray>,
  receipt_siblings: List<ByteArray>,
  acknowledgement_siblings: List<ByteArray>,
  voucher_policy_is_used: Bool,
) -> Bool {
  let (input, input_datum, output_datum) =
    channel_thread(inputs, outputs, policy, script_hash)
  expect
    voucher_policy_is_used || output_datum.voucher_supply == input_datum.voucher_supply
  expect Some(raw) = pairs.get_first(redeemers, Spend(input.output_reference))
  expect redeemer: SpendChannelRedeemer = raw
  let id = channel_id(output_datum.token.name)
  let port_id = output_datum.port_id
  let old_root = old.state.ibc_state_root
  let ordered = input_datum.state.channel.ordering == Ordered
  let expected_root =
    when redeemer is {
      SendPacket { packet: sent_packet } -> {
        let commitment = packet.commit_packet(sent_packet)
        expect
          channel_datum.validate_send_packet(
            input_datum,
            output_datum,
            sent_packet,
            commitment,
          )
        let after_sequence =
          ibc_state_commitment.apply_update(
            old_root,
            packet_keys.next_sequence_send_path(port_id, id),
            cbor.serialise(input_datum.state.next_sequence_send),
            cbor.serialise(output_datum.state.next_sequence_send),
            send_siblings,
          )
        ibc_state_commitment.apply_update(
          after_sequence,
          packet_keys.packet_commitment_path(port_id, id, sent_packet.sequence),
          "",
          cbor.serialise(commitment),
          commitment_siblings,
        )
      }
      RecvPacket { packet: received_packet, proof_height, .. } -> {
        expect Some(acknowledgement) =
          pairs.get_first(
            output_datum.state.packet_acknowledgement,
            received_packet.sequence,
          )
        expect
          channel_datum.validate_recv_packet(
            input_datum,
            output_datum,
            received_packet,
            acknowledgement,
            proof_height,
          )
        let after_sequence =
          if ordered {
            ibc_state_commitment.apply_update(
              old_root,
              packet_keys.next_sequence_recv_path(port_id, id),
              cbor.serialise(input_datum.state.next_sequence_recv),
              cbor.serialise(output_datum.state.next_sequence_recv),
              recv_siblings,
            )
          } else {
            old_root
          }
        let after_receipt =
          if ordered {
            after_sequence
          } else {
            ibc_state_commitment.apply_update(
              after_sequence,
              packet_keys.packet_receipt_path(
                port_id,
                id,
                received_packet.sequence,
              ),
              "",
              cbor.serialise(""),
              receipt_siblings,
            )
          }
        ibc_state_commitment.apply_update(
          after_receipt,
          packet_keys.packet_acknowledgement_path(
            port_id,
            id,
            received_packet.sequence,
          ),
          "",
          cbor.serialise(acknowledgement),
          acknowledgement_siblings,
        )
      }
      AcknowledgePacket { packet: acknowledged_packet, .. } -> {
        expect
          channel_datum.validate_acknowledge_packet(
            input_datum,
            output_datum,
            acknowledged_packet,
          )
        let after_sequence =
          if ordered {
            ibc_state_commitment.apply_update(
              old_root,
              packet_keys.next_sequence_ack_path(port_id, id),
              cbor.serialise(input_datum.state.next_sequence_ack),
              cbor.serialise(output_datum.state.next_sequence_ack),
              ack_siblings,
            )
          } else {
            old_root
          }
        delete_packet_commitment(
          after_sequence,
          input_datum,
          port_id,
          id,
          acknowledged_packet.sequence,
          commitment_siblings,
        )
      }
      TimeoutPacket { packet: timed_out_packet, .. } -> {
        expect
          channel_datum.validate_timeout_packet(
            input_datum,
            output_datum,
            timed_out_packet,
          )
        let channel_changed =
          input_datum.state.channel != output_datum.state.channel
        let after_channel =
          if channel_changed {
            expect ordered
            ibc_state_commitment.apply_update(
              old_root,
              channel_keys.channel_path(port_id, id),
              cbor.serialise(input_datum.state.channel),
              cbor.serialise(output_datum.state.channel),
              channel_siblings,
            )
          } else {
            expect channel_siblings == []
            old_root
          }
        delete_packet_commitment(
          after_channel,
          input_datum,
          port_id,
          id,
          timed_out_packet.sequence,
          commitment_siblings,
        )
      }
      PrunePacketHistory { sequence, .. } -> {
        expect Some(acknowledgement) =
          pairs.get_first(input_datum.state.packet_acknowledgement, sequence)
        let after_receipt =
          if ordered {
            expect receipt_siblings == []
            old_root
          } else {
            expect Some(receipt) =
              pairs.get_first(input_datum.state.packet_receipt, sequence)
            ibc_state_commitment.apply_update(
              old_root,
              packet_keys.packet_receipt_path(port_id, id, sequence),
              cbor.serialise(receipt),
              "",
              receipt_siblings,
            )
          }
        ibc_state_commitment.apply_update(
          after_receipt,
          packet_keys.packet_acknowledgement_path(port_id, id, sequence),
          cbor.serialise(acknowledgement),
          "",
          acknowledgement_siblings,
        )
      }
      _ -> fail
    }
  expected_root == new.state.ibc_state_root
}

validator mint_lifecycle_packet_marker(
  host_policy: PolicyId,
  channel_script_hash: Hash<Blake2b_224, Script>,
  channel_policy: PolicyId,
  voucher_minting_policy_id: PolicyId,
) {
  mint(
    redeemer: LifecyclePacketMarkerRedeemer,
    own_policy: PolicyId,
    transaction: Transaction,
  ) {
    let AuthorizePacket = redeemer
    let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
    let (host_input, host_output, old, new) =
      host_thread(inputs, outputs, host_policy)
    expect Some(raw_host_redeemer) =
      pairs.get_first(redeemers, Spend(host_input.output_reference))
    expect HandlePacket {
      channel_siblings,
      next_sequence_send_siblings,
      next_sequence_recv_siblings,
      next_sequence_ack_siblings,
      packet_commitment_siblings,
      packet_receipt_siblings,
      packet_acknowledgement_siblings,
    }: HostStateRedeemer = raw_host_redeemer
    expect
      auth.mint_auth_token(
        mint,
        AuthToken { policy_id: own_policy, name: lifecycle_marker_token_name },
      )
    expect
      quantity_of(host_output.value, own_policy, lifecycle_marker_token_name) == quantity_of(
        host_input.output.value,
        own_policy,
        lifecycle_marker_token_name,
      ) + 1
    validate_handle_packet(
      old,
      new,
      inputs,
      outputs,
      redeemers,
      channel_policy,
      channel_script_hash,
      channel_siblings,
      next_sequence_send_siblings,
      next_sequence_recv_siblings,
      next_sequence_ack_siblings,
      packet_commitment_siblings,
      packet_receipt_siblings,
      packet_acknowledgement_siblings,
      !(mint |> tokens(voucher_minting_policy_id) |> dict.is_empty),
    )
  }

  else(_) {
    fail
  }
}
