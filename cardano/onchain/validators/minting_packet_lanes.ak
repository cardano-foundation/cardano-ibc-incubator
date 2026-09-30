use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/packet_config.{PacketRegistry, registry_token_name}
use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/send_sequencer.{SendSequencerDatum}
use ibc/core/ics_004/types/keys
use ibc/core/ics_004/types/state.{Closed, Init, Open, TryOpen}
use ibc/utils/int as int_utils
use ibc/utils/validator_utils

pub type IssueLanes {
  CreateRegistry
  CreateChannelLanes { channel_token: AuthToken }
}

validator minting_packet_lanes(
  nonce: OutputReference,
  config_token: AuthToken,
  channel_policy: PolicyId,
) {
  mint(action: IssueLanes, policy: PolicyId, transaction: Transaction) {
    let registry_token =
      AuthToken { policy_id: policy, name: registry_token_name }
    when action is {
      CreateRegistry -> {
        expect Some(_) = transaction.find_input(transaction.inputs, nonce)
        expect
          assets.tokens(transaction.mint, policy) == dict.singleton(
            registry_token_name,
            1,
          )
        expect [output] =
          list.filter(
            transaction.outputs,
            fn(output) { auth.contain_auth_token(output, registry_token) },
          )
        expect output.address.payment_credential == Script(policy)
        expect datum: PacketRegistry = validator_utils.get_inline_datum(output)
        datum.next_channel == 0
      }
      CreateChannelLanes { channel_token } -> {
        let config = packet_config.reference(transaction, config_token)
        expect config.state_policy == policy
        expect channel_token.policy_id == channel_policy
        expect [channel_input] =
          list.filter(
            transaction.reference_inputs,
            fn(input) { auth.contain_auth_token(input.output, channel_token) },
          )
        expect channel: ChannelDatum =
          validator_utils.get_inline_datum(channel_input.output)
        expect channel.token == channel_token
        expect
          list.has([Init, TryOpen, Open, Closed], channel.state.channel.state)
        expect
          if channel.port_id == "transfer" {
            channel.state.next_sequence_send == 1 && channel.state.packet_commitment == [] && channel.state.packet_receipt == [] && channel.state.packet_acknowledgement == []
          } else {
            True
          }
        expect [registry_input] =
          list.filter(
            transaction.inputs,
            fn(input) { auth.contain_auth_token(input.output, registry_token) },
          )
        expect old: PacketRegistry =
          validator_utils.get_inline_datum(registry_input.output)
        let channel_id =
          keys.format_channel_identifier(int_utils.to_string(old.next_channel))
        expect
          auth.extract_token_sequence(channel_token.name) == int_utils.to_string(
            old.next_channel,
          )
        let registry_output =
          validator_utils.find_unique_continuation_output(
            registry_input.output,
            transaction.outputs,
            registry_token,
          )
        expect new: PacketRegistry =
          validator_utils.get_inline_datum(registry_output)
        expect new.next_channel == old.next_channel + 1
        let sequence_name =
          packet_lanes.sequencer_token_name(channel.port_id, channel_id)
        let expected =
          list.foldl(
            list.range(0, config.lane_count - 1),
            dict.singleton(sequence_name, 1),
            fn(lane, minted) {
              let token =
                AuthToken {
                  policy_id: policy,
                  name: packet_lanes.lane_token_name(
                    channel.port_id,
                    channel_id,
                    lane,
                    config.lane_count,
                  ),
                }
              expect [output] =
                list.filter(
                  transaction.outputs,
                  fn(output) { auth.contain_auth_token(output, token) },
                )
              expect
                output.address.payment_credential == Script(config.guard_hash)
              expect datum: PacketLaneDatum =
                validator_utils.get_inline_datum(output)
              expect
                datum == packet_lane_datum.empty(
                  channel.port_id,
                  channel_id,
                  lane,
                  config.lane_count,
                )
              dict.insert(minted, token.name, 1)
            },
          )
        expect assets.tokens(transaction.mint, policy) == expected
        expect [sequence_output] =
          list.filter(
            transaction.outputs,
            fn(output) {
              auth.contain_auth_token(
                output,
                AuthToken { policy_id: policy, name: sequence_name },
              )
            },
          )
        expect
          sequence_output.address.payment_credential == Script(
            config.guard_hash,
          )
        expect sequencer: SendSequencerDatum =
          validator_utils.get_inline_datum(sequence_output)
        sequencer == SendSequencerDatum {
          port_id: channel.port_id,
          channel_id,
          version: 0,
          next_sequence_send: 1,
        }
      }
    }
  }

  spend(
    _datum: Option<PacketRegistry>,
    _redeemer: Void,
    ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(input) = transaction.find_input(transaction.inputs, ref)
    expect Script(policy) = input.output.address.payment_credential
    expect
      auth.contain_auth_token(
        input.output,
        AuthToken { policy_id: policy, name: registry_token_name },
      )
    expect Some(raw) = pairs.get_first(transaction.redeemers, Mint(policy))
    expect CreateChannelLanes { .. }: IssueLanes = raw
    True
  }

  else(_) {
    fail
  }
}
