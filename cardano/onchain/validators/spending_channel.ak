use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Address}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Mint, Output, OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{
  AcknowledgePacket, ChanCloseConfirm, ChanCloseInit, ChanOpenAck,
  ChanOpenConfirm, RecvPacket, RefreshUtxo, SendPacket, SpendChannelRedeemer,
  TimeoutPacket,
}
use ibc/utils/validator_utils

validator spend_channel(
  chan_open_ack_policy_id: PolicyId,
  chan_open_confirm_policy_id: PolicyId,
  chan_close_init_policy_id: PolicyId,
  chan_close_confirm_policy_id: PolicyId,
  recv_packet_policy_id: PolicyId,
  send_packet_policy_id: PolicyId,
  timeout_packet_policy_id: PolicyId,
  acknowledge_packet_policy_id: PolicyId,
) {
  spend(
    optional_datum: Option<ChannelDatum>,
    redeemer: SpendChannelRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, redeemers, outputs, .. } = transaction
    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect Some(datum) = optional_datum
    let spent_output = spent_input.output
    when redeemer is {
      ChanOpenAck { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_open_ack_policy_id))

        expect redeemer: AuthToken = redeemer

        expect _ = validate_output_datum(spent_output.address, outputs)

        redeemer == datum.token
      }

      ChanOpenConfirm { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_open_confirm_policy_id))

        expect redeemer: AuthToken = redeemer

        expect _ = validate_output_datum(spent_output.address, outputs)

        redeemer == datum.token
      }
      ChanCloseInit -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_close_init_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output.address, outputs)
        redeemer == datum.token
      }
      ChanCloseConfirm { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(chan_close_confirm_policy_id))

        expect redeemer: AuthToken = redeemer

        redeemer == datum.token
      }
      RecvPacket { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(recv_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output.address, outputs)
        redeemer == datum.token
      }
      SendPacket { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(send_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output.address, outputs)
        redeemer == datum.token
      }
      TimeoutPacket { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(timeout_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output.address, outputs)
        redeemer == datum.token
      }
      AcknowledgePacket { .. } -> {
        expect Some(redeemer) =
          pairs.get_first(redeemers, Mint(acknowledge_packet_policy_id))

        expect redeemer: AuthToken = redeemer
        expect _ = validate_output_datum(spent_output.address, outputs)
        redeemer == datum.token
      }
      RefreshUtxo -> {
        expect auth.contain_auth_token(spent_output, datum.token)

        let updated_output = find_updated_output(spent_output.address, outputs)
        let updated_datum = extract_output_datum(updated_output)

        and {
          auth.contains_only_auth_tokens(updated_output, [datum.token]),
          channel_datum_mod.validate_refresh_utxo(datum, updated_datum),
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn find_updated_output(address: Address, outputs: List<Output>) -> Output {
  trace @"address": address
  trace @"outputs.size": list.length(outputs)
  let filtered_outputs =
    list.filter(outputs, fn(output) { output.address == address })
  trace @"filtered_outputs.size": list.length(filtered_outputs)
  expect [updated_output] = filtered_outputs
  updated_output
}

fn extract_output_datum(output: Output) -> ChannelDatum {
  expect datum: ChannelDatum = validator_utils.get_inline_datum(output)
  datum
}

fn validate_output_datum(address: Address, outputs: List<Output>) {
  find_updated_output(address, outputs) |> extract_output_datum()
}
