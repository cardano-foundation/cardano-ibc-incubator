use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Mint, Output, Redeemer, ScriptPurpose, Spend}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenAck, ChanOpenConfirm, ChanOpenInit, ChanOpenTry, MintChannelRedeemer,
  SpendChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/utils/validator_utils

pub fn validate_channel_open_init(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Channel {
  // Channel opening callbacks are tied to the channel mint operation.
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  expect ChanOpenInit = mint_channel_redeemer

  expect channel_keys.is_valid_channel_id(channel_id)

  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)

  let channel_token_name =
    auth.generate_token_name(
      host_state_nft,
      channel_keys.channel_prefix,
      channel_sequence,
    )

  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  channel_datum.state.channel
}

pub fn validate_channel_open_try(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<(Channel, ByteArray)> {
  // Channel opening callbacks are tied to the channel mint operation.
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  expect ChanOpenTry { counterparty_version, .. } = mint_channel_redeemer

  expect channel_keys.is_valid_channel_id(channel_id)

  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      host_state_nft,
      channel_keys.channel_prefix,
      channel_sequence,
    )

  let channel_token =
    AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }

  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some((channel_datum.state.channel, counterparty_version))
}

pub fn validate_chan_open_ack(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<(Channel, ByteArray)> {
  expect channel_keys.is_valid_channel_id(channel_id)

  let channel_token =
    channel_auth_token(channel_minting_policy_id, host_state_nft, channel_id)
  expect Some(channel_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  expect Some(spend_channel_redeemer) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer
  expect ChanOpenAck { counterparty_version, .. } = spend_channel_redeemer

  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some((channel_datum.state.channel, counterparty_version))
}

pub fn validate_chan_open_confirm(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Option<Channel> {
  expect channel_keys.is_valid_channel_id(channel_id)

  let channel_token =
    channel_auth_token(channel_minting_policy_id, host_state_nft, channel_id)
  expect Some(channel_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  expect Some(spend_channel_redeemer) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer
  expect ChanOpenConfirm { .. } = spend_channel_redeemer

  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )

  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)

  expect channel_datum.port_id == port_id

  Some(channel_datum.state.channel)
}

pub fn extract_channel_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  channel_id: ByteArray,
) -> Option<SpendChannelRedeemer> {
  expect channel_keys.is_valid_channel_id(channel_id)

  let channel_token =
    channel_auth_token(channel_minting_policy_id, host_state_nft, channel_id)
  expect Some(channel_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )

  expect Some(spend_channel_redeemer) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect spend_channel_redeemer: SpendChannelRedeemer = spend_channel_redeemer

  Some(spend_channel_redeemer)
}

fn channel_auth_token(
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  channel_id: ByteArray,
) -> AuthToken {
  // Channel auth tokens are sequence-derived from the HostState NFT, so callback
  // validation can locate the exact channel UTxO without address-level uniqueness.
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let channel_token_name =
    auth.generate_token_name(
      host_state_nft,
      channel_keys.channel_prefix,
      channel_sequence,
    )
  AuthToken { policy_id: channel_minting_policy_id, name: channel_token_name }
}
