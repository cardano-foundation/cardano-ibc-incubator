use cardano/address
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use ibc/apps/transfer/liquidity.{LiquidityDatum}

const liquidity_policy =
  #"11111111111111111111111111111111111111111111111111111111"

fn datum(index: Int, amount: Int) -> LiquidityDatum {
  LiquidityDatum {
    port_id: "transfer",
    channel_id: "channel-0",
    denom: "lovelace",
    asset_policy: "",
    asset_name: "",
    deposit: OutputReference {
      transaction_id: #"abababababababababababababababababababababababababababababababab",
      output_index: index,
    },
    amount,
  }
}

fn output(datum: LiquidityDatum) -> Output {
  let token = liquidity.identity(datum, liquidity_policy)
  Output {
    address: address.from_script(liquidity_policy),
    value: assets.from_asset(token.policy_id, token.name, 1)
      |> assets.add("", "", datum.amount + 2_000_000),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn input(index: Int, amount: Int) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
      output_index: index,
    },
    output: output(datum(index, amount)),
  }
}

test liquidity_same_channel_and_asset_have_distinct_deposits() {
  liquidity.identity(datum(0, 10), liquidity_policy) != liquidity.identity(
    datum(1, 10),
    liquidity_policy,
  )
}

test liquidity_release_can_use_independent_outputs() {
  let first =
    liquidity.released_amount(
      input(0, 10),
      [output(datum(0, 4))],
      liquidity_policy,
    )
  let second =
    liquidity.released_amount(
      input(1, 10),
      [output(datum(1, 7))],
      liquidity_policy,
    )
  first == 6 && second == 3
}

test liquidity_release_can_combine_balances() {
  liquidity.total_release(
    [input(0, 10), input(1, 10)],
    [output(datum(0, 0)), output(datum(1, 5))],
    liquidity_policy,
    "transfer",
    "channel-0",
    "lovelace",
    "",
    "",
  ) == 15
}

test liquidity_rejects_duplicate_input_accounting() fail {
  expect _ =
    liquidity.total_release(
      [input(0, 10), input(0, 10)],
      [output(datum(0, 0))],
      liquidity_policy,
      "transfer",
      "channel-0",
      "lovelace",
      "",
      "",
    )
}

test liquidity_rejects_cross_channel_release() fail {
  expect _ =
    liquidity.total_release(
      [input(0, 10)],
      [output(datum(0, 0))],
      liquidity_policy,
      "transfer",
      "channel-1",
      "lovelace",
      "",
      "",
    )
}

test liquidity_cannot_sweep_minimum_ada_reserve() fail {
  let next = output(datum(0, 0))
  expect _ =
    liquidity.released_amount(
      input(0, 10),
      [Output { ..next, value: assets.add(next.value, "", "", -1) }],
      liquidity_policy,
    )
}

test liquidity_cannot_change_identity() fail {
  expect _ =
    liquidity.released_amount(
      input(0, 10),
      [output(datum(1, 0))],
      liquidity_policy,
    )
}

test liquidity_cannot_duplicate_successor() fail {
  expect _ =
    liquidity.released_amount(
      input(0, 10),
      [output(datum(0, 0)), output(datum(0, 0))],
      liquidity_policy,
    )
}

test liquidity_cannot_hide_unrelated_assets() {
  let next = output(datum(0, 10))
  !liquidity.valid_value(
    Output {
      ..next,
      value: assets.add(
        next.value,
        #"22222222222222222222222222222222222222222222222222222222",
        "other",
        1,
      ),
    },
    datum(0, 10),
    liquidity_policy,
  )
}
