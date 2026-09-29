use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Output, OutputReference}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_lanes
use ibc/utils/validator_utils

/// Each funded intent creates its own liquidity identity. Receiving or
/// refunding a packet may select any sufficient set for this channel and asset.
pub type LiquidityDatum {
  port_id: ByteArray,
  channel_id: ByteArray,
  denom: ByteArray,
  asset_policy: PolicyId,
  asset_name: ByteArray,
  deposit: OutputReference,
  amount: Int,
}

pub fn identity(datum: LiquidityDatum, liquidity_policy: PolicyId) -> AuthToken {
  AuthToken {
    policy_id: liquidity_policy,
    name: packet_lanes.liquidity_token_name(
      datum.port_id,
      datum.channel_id,
      datum.denom,
      datum.deposit.transaction_id,
      datum.deposit.output_index,
    ),
  }
}

/// A balance excludes the minimum ADA reserve. No unaccounted non-ADA asset
/// can enter a liquidity output or be taken as change during release.
pub fn valid_value(
  output: Output,
  datum: LiquidityDatum,
  liquidity_policy: PolicyId,
) -> Bool {
  let token = identity(datum, liquidity_policy)
  expect datum.amount >= 0
  expect liquidity_policy != datum.asset_policy
  let expected_assets =
    assets.from_asset(token.policy_id, token.name, 1)
      |> assets.add(datum.asset_policy, datum.asset_name, datum.amount)
  and {
    auth.contain_auth_token(output, token),
    assets.match_assets(output.value, expected_assets),
    assets.lovelace_of(output.value) >= assets.lovelace_of(expected_assets),
  }
}

/// Verify a single authenticated continuation and preserve its ADA reserve.
/// The enclosing transfer operation must also prove the packet and bind the
/// total decrease to its recipient payment. This function grants no release
/// authority by itself.
pub fn released_amount(
  input: Input,
  outputs: List<Output>,
  liquidity_policy: PolicyId,
) -> Int {
  expect old: LiquidityDatum = validator_utils.get_inline_datum(input.output)
  expect valid_value(input.output, old, liquidity_policy)
  let token = identity(old, liquidity_policy)
  expect [output] =
    list.filter(outputs, fn(output) { auth.contain_auth_token(output, token) })
  expect output.address == input.output.address
  expect new: LiquidityDatum = validator_utils.get_inline_datum(output)
  expect valid_value(output, new, liquidity_policy)
  expect new == LiquidityDatum { ..old, amount: new.amount }
  let released = old.amount - new.amount
  expect released >= 0
  let reserve =
    assets.lovelace_of(input.output.value) - if old.asset_policy == "" && old.asset_name == "" {
      old.amount
    } else {
      0
    }
  let new_reserve =
    assets.lovelace_of(output.value) - if new.asset_policy == "" && new.asset_name == "" {
      new.amount
    } else {
      0
    }
  expect new_reserve >= reserve
  released
}

/// Sum only identities for the exact local channel and denomination. Repeated
/// input references cannot be counted twice even by an off-chain caller.
pub fn total_release(
  inputs: List<Input>,
  outputs: List<Output>,
  liquidity_policy: PolicyId,
  port_id: ByteArray,
  channel_id: ByteArray,
  denom: ByteArray,
  asset_policy: PolicyId,
  asset_name: ByteArray,
) -> Int {
  expect inputs != []
  expect
    list.length(
      list.unique(list.map(inputs, fn(input) { input.output_reference })),
    ) == list.length(inputs)
  list.foldl(
    inputs,
    0,
    fn(input, total) {
      expect datum: LiquidityDatum =
        validator_utils.get_inline_datum(input.output)
      expect datum.port_id == port_id
      expect datum.channel_id == channel_id
      expect datum.denom == denom
      expect datum.asset_policy == asset_policy
      expect datum.asset_name == asset_name
      total + released_amount(input, outputs, liquidity_policy)
    },
  )
}
