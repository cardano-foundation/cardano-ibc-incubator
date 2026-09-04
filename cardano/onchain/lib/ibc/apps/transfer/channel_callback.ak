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

fn new_channel_datum(
  outputs: List<Output>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> ChannelDatum {
  expect channel_keys.is_valid_channel_id(channel_id)
  let channel_token =
    channel_auth_token(channel_minting_policy_id, host_state_nft, channel_id)
  channel_output_datum(outputs, channel_token, port_id)
}

fn channel_output_datum(
  outputs: List<Output>,
  channel_token: AuthToken,
  port_id: ByteArray,
) -> ChannelDatum {
  expect [channel_output] =
    list.filter(
      outputs,
      fn(output) { auth.contain_auth_token(output, channel_token) },
    )
  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_output)
  expect channel_datum.port_id == port_id
  channel_datum
}

fn channel_transition(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> (ChannelDatum, SpendChannelRedeemer) {
  let (channel_token, spend_channel_redeemer) =
    require_channel_redeemer(
      inputs,
      redeemers,
      channel_minting_policy_id,
      host_state_nft,
      channel_id,
    )
  let channel_datum = channel_output_datum(outputs, channel_token, port_id)
  (channel_datum, spend_channel_redeemer)
}

fn require_channel_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  channel_id: ByteArray,
) -> (AuthToken, SpendChannelRedeemer) {
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
  (channel_token, spend_channel_redeemer)
}

fn require_mint_channel_redeemer(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
) -> MintChannelRedeemer {
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))
  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer
  mint_channel_redeemer
}

pub fn validate_channel_open_init(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  outputs: List<Output>,
  port_id: ByteArray,
  channel_id: ByteArray,
) -> Channel {
  // Channel opening callbacks are tied to the channel mint operation.
  let mint_channel_redeemer =
    require_mint_channel_redeemer(redeemers, channel_minting_policy_id)
  expect ChanOpenInit = mint_channel_redeemer

  let channel_datum =
    new_channel_datum(
      outputs,
      channel_minting_policy_id,
      host_state_nft,
      port_id,
      channel_id,
    )
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
  let mint_channel_redeemer =
    require_mint_channel_redeemer(redeemers, channel_minting_policy_id)
  expect ChanOpenTry { counterparty_version, .. } = mint_channel_redeemer

  let channel_datum =
    new_channel_datum(
      outputs,
      channel_minting_policy_id,
      host_state_nft,
      port_id,
      channel_id,
    )
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
  let (channel_datum, spend_channel_redeemer) =
    channel_transition(
      inputs,
      redeemers,
      channel_minting_policy_id,
      host_state_nft,
      outputs,
      port_id,
      channel_id,
    )
  expect ChanOpenAck { counterparty_version, .. } = spend_channel_redeemer
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
  let (channel_datum, spend_channel_redeemer) =
    channel_transition(
      inputs,
      redeemers,
      channel_minting_policy_id,
      host_state_nft,
      outputs,
      port_id,
      channel_id,
    )
  expect ChanOpenConfirm { .. } = spend_channel_redeemer
  Some(channel_datum.state.channel)
}

pub fn extract_channel_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  channel_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  channel_id: ByteArray,
) -> Option<SpendChannelRedeemer> {
  let (_, spend_channel_redeemer) =
    require_channel_redeemer(
      inputs,
      redeemers,
      channel_minting_policy_id,
      host_state_nft,
      channel_id,
    )
  Some(spend_channel_redeemer)
}

pub fn channel_auth_token(
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
