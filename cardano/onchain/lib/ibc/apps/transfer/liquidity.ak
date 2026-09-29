use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
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
  reserve_owner: Address,
}

pub type ReserveRefund {
  liquidity_policy: PolicyId,
  token_name: ByteArray,
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

pub fn reserve(input: Input, datum: LiquidityDatum) -> Int {
  assets.lovelace_of(input.output.value) - if datum.asset_policy == "" && datum.asset_name == "" {
    datum.amount
  } else {
    0
  }
}

/// A full drain burns its identity and refunds the entire reserve to the
/// immutable owner. The per-identity refund datum prevents one payment from
/// satisfying several retirements. The operation validator must authorize the
/// returned principal separately, or require it to be zero for empty cleanup.
pub fn retired_amount(
  input: Input,
  transaction: Transaction,
  liquidity_policy: PolicyId,
) -> Int {
  expect old: LiquidityDatum = validator_utils.get_inline_datum(input.output)
  expect valid_value(input.output, old, liquidity_policy)
  let token = identity(old, liquidity_policy)
  expect [authenticated_input] =
    list.filter(
      transaction.inputs,
      fn(candidate) { auth.contain_auth_token(candidate.output, token) },
    )
  expect authenticated_input == input
  expect assets.quantity_of(transaction.mint, token.policy_id, token.name) == -1
  expect
    list.all(
      transaction.outputs,
      fn(output) {
        assets.quantity_of(output.value, token.policy_id, token.name) == 0
      },
    )
  let refund: Data = ReserveRefund { liquidity_policy, token_name: token.name }
  expect [payment] =
    list.filter(
      transaction.outputs,
      fn(output) {
        output.address == old.reserve_owner && output.datum == InlineDatum(
          refund,
        )
      },
    )
  expect assets.match_assets(payment.value, assets.zero)
  expect assets.lovelace_of(payment.value) >= reserve(input, old)
  old.amount
}

/// Merge balances into one existing identity without releasing principal.
/// Every removed output burns its NFT and reimburses its own reserve owner.
/// The survivor retains its owner and at least its existing ADA reserve.
pub fn consolidate(
  inputs: List<Input>,
  transaction: Transaction,
  liquidity_policy: PolicyId,
  survivor_ref: OutputReference,
) -> Bool {
  expect list.length(inputs) >= 2 && list.length(inputs) <= 5
  expect
    list.length(
      list.unique(list.map(inputs, fn(input) { input.output_reference })),
    ) == list.length(inputs)
  expect Some(survivor) = transaction.find_input(inputs, survivor_ref)
  expect old: LiquidityDatum = validator_utils.get_inline_datum(survivor.output)
  expect valid_value(survivor.output, old, liquidity_policy)
  let token = identity(old, liquidity_policy)
  expect assets.quantity_of(transaction.mint, token.policy_id, token.name) == 0
  expect [output] =
    list.filter(
      transaction.outputs,
      fn(candidate) { auth.contain_auth_token(candidate, token) },
    )
  expect output.address == survivor.output.address
  let total =
    list.foldl(
      inputs,
      0,
      fn(input, amount) {
        expect list.has(transaction.inputs, input)
        expect datum: LiquidityDatum =
          validator_utils.get_inline_datum(input.output)
        expect datum.port_id == old.port_id
        expect datum.channel_id == old.channel_id
        expect datum.denom == old.denom
        expect datum.asset_policy == old.asset_policy
        expect datum.asset_name == old.asset_name
        if input.output_reference == survivor_ref {
          amount + datum.amount
        } else {
          amount + retired_amount(input, transaction, liquidity_policy)
        }
      },
    )
  expect new: LiquidityDatum = validator_utils.get_inline_datum(output)
  expect new == LiquidityDatum { ..old, amount: total }
  expect valid_value(output, new, liquidity_policy)
  let updated = Input { ..survivor, output }
  reserve(updated, new) >= reserve(survivor, old)
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
