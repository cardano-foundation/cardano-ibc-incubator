use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/math
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{Script, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/packet_config.{
  PacketRegistry, config_token_name, registry_token_name,
}
use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/core/ics_004/packet_lanes
use ibc/utils/shutdown
use ibc/utils/validator_utils

pub fn certificate_name(channel_token: AuthToken) -> ByteArray {
  crypto.blake2b_256(bytearray.concat("ibc/retired-lanes/", channel_token.name))
}

pub fn channel_drained(
  transaction: Transaction,
  config_policy: PolicyId,
  channel: ChannelDatum,
) -> Bool {
  let config =
    packet_config.reference(
      transaction,
      AuthToken { policy_id: config_policy, name: config_token_name },
    )
  expect [registry] =
    list.filter(
      transaction.reference_inputs,
      fn(input) {
        assets.has_nft(
          input.output.value,
          config.state_policy,
          registry_token_name,
        )
      },
    )
  expect state: PacketRegistry =
    validator_utils.get_inline_datum(registry.output)
  expect Some(sequence) =
    int.from_utf8(auth.extract_token_sequence(channel.token.name))
  sequence >= state.next_channel || list.any(
    transaction.reference_inputs,
    fn(input) {
      if assets.has_nft(
        input.output.value,
        config.state_policy,
        certificate_name(channel.token),
      ) {
        expect certificate: PacketRegistry =
          validator_utils.get_inline_datum(input.output)
        certificate.next_channel == config.lane_count
      } else {
        False
      }
    },
  )
}

pub fn retire_lanes(
  transaction: Transaction,
  policy: PolicyId,
  config_token: AuthToken,
  channel_token: AuthToken,
) -> Bool {
  let config = packet_config.reference(transaction, config_token)
  expect config.state_policy == policy
  let deployer = shutdown.authority(transaction, config.host_policy)
  expect [channel_input] =
    list.filter(
      transaction.reference_inputs,
      fn(input) { auth.contain_auth_token(input.output, channel_token) },
    )
  expect channel: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)
  expect channel.token == channel_token
  let channel_id =
    bytearray.concat(
      "channel-",
      auth.extract_token_sequence(channel_token.name),
    )
  let certificate = certificate_name(channel_token)
  let previous =
    list.filter(
      transaction.inputs,
      fn(input) { assets.has_nft(input.output.value, policy, certificate) },
    )
  let first = previous == []
  let start =
    when previous is {
      [] -> 0
      [input] -> {
        expect old: PacketRegistry =
          validator_utils.get_inline_datum(input.output)
        old.next_channel
      }
      _ -> fail
    }
  expect start >= 0 && start < config.lane_count
  let end = math.min(start + 1, config.lane_count)
  let available =
    if first {
      list.concat(transaction.inputs, transaction.reference_inputs)
    } else {
      transaction.inputs
    }
  let last =
    if first {
      config.lane_count
    } else {
      end
    }
  let lane_prefix = packet_lanes.lane_token_prefix(channel.port_id, channel_id)
  let (balances, burns, reserve) =
    list.foldl(
      list.range(start, last - 1),
      (dict.empty, dict.empty, 0),
      fn(lane, acc) {
        let (balances, burns, reserve) = acc
        let name =
          crypto.sha2_256(
            bytearray.concat(
              lane_prefix,
              bytearray.from_int_big_endian(lane, 4),
            ),
          )
        expect Some(input) =
          list.find(
            available,
            fn(input) { assets.has_nft(input.output.value, policy, name) },
          )
        expect datum: PacketLaneDatum =
          validator_utils.get_inline_datum(input.output)
        expect datum.commitments == []
        let next_balances =
          list.foldl(
            datum.balances,
            balances,
            fn(entry, totals) {
              let Pair(denom, amount) = entry
              let previous =
                when dict.get(totals, denom) is {
                  None -> 0
                  Some(value) -> value
                }
              dict.insert(totals, denom, previous + amount)
            },
          )
        if lane < end {
          expect list.has(transaction.inputs, input)
          (
            next_balances,
            dict.insert(burns, name, -1),
            reserve + assets.lovelace_of(input.output.value),
          )
        } else {
          (next_balances, burns, reserve)
        }
      },
    )
  // Before consuming any lane, authenticate all lanes and freeze new sends by
  // burning the sequencer. Existing obligations must already be zero.
  expect !first || list.all(dict.values(balances), fn(amount) { amount == 0 })
  let (expected_mint, refund) =
    if first {
      let sequence_name =
        packet_lanes.sequencer_token_name(channel.port_id, channel_id)
      expect [sequencer] =
        list.filter(
          transaction.inputs,
          fn(input) {
            assets.has_nft(input.output.value, policy, sequence_name)
          },
        )
      (
        dict.insert(dict.insert(burns, sequence_name, -1), certificate, 1),
        reserve + assets.lovelace_of(sequencer.output.value) - 2_000_000,
      )
    } else {
      (burns, reserve)
    }
  expect assets.tokens(transaction.mint, policy) == expected_mint
  expect [output] =
    list.filter(
      transaction.outputs,
      fn(output) { assets.has_nft(output.value, policy, certificate) },
    )
  expect output.address.payment_credential == Script(policy)
  expect next: PacketRegistry = validator_utils.get_inline_datum(output)
  expect next.next_channel == end
  expect
    output.value == assets.add(
      assets.from_asset(policy, certificate, 1),
      "",
      "",
      2_000_000,
    )
  let refunded =
    list.foldl(
      transaction.outputs,
      0,
      fn(output, amount) {
        if output.address.payment_credential == VerificationKey(deployer) {
          amount + assets.lovelace_of(output.value)
        } else {
          amount
        }
      },
    )
  refunded >= refund
}
