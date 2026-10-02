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
    reserve_owner: address.from_verification_key(liquidity_policy),
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

fn retirement(index: Int, amount: Int) -> transaction.Transaction {
  let old = datum(index, amount)
  let token = liquidity.identity(old, liquidity_policy)
  let payment =
    Output {
      address: old.reserve_owner,
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(
        liquidity.ReserveRefund { liquidity_policy, token_name: token.name },
      ),
      reference_script: None,
    }
  transaction.Transaction {
    ..transaction.placeholder,
    inputs: [input(index, amount)],
    outputs: [payment],
    mint: assets.from_asset(liquidity_policy, token.name, -1),
  }
}

test liquidity_full_drain_burns_identity_and_returns_reserve() {
  liquidity.retired_amount(input(0, 10), retirement(0, 10), liquidity_policy) == 10
}

test liquidity_empty_retirement_reclaims_reserve() {
  liquidity.retired_amount(input(0, 0), retirement(0, 0), liquidity_policy) == 0
}

test liquidity_retirement_requires_burn() fail {
  let tx = retirement(0, 10)
  expect _ =
    liquidity.retired_amount(
      input(0, 10),
      transaction.Transaction { ..tx, mint: assets.zero },
      liquidity_policy,
    )
}

test liquidity_retirement_requires_full_reserve() fail {
  let tx = retirement(0, 10)
  expect [payment] = tx.outputs
  expect _ =
    liquidity.retired_amount(
      input(0, 10),
      transaction.Transaction {
        ..tx,
        outputs: [Output { ..payment, value: assets.from_lovelace(1_999_999) }],
      },
      liquidity_policy,
    )
}

test liquidity_retirement_cannot_redirect_reserve() fail {
  let tx = retirement(0, 10)
  expect [payment] = tx.outputs
  expect _ =
    liquidity.retired_amount(
      input(0, 10),
      transaction.Transaction {
        ..tx,
        outputs: [
          Output { ..payment, address: address.from_script(liquidity_policy) },
        ],
      },
      liquidity_policy,
    )
}

test liquidity_retirement_cannot_keep_identity() fail {
  let tx = retirement(0, 10)
  expect _ =
    liquidity.retired_amount(
      input(0, 10),
      transaction.Transaction {
        ..tx,
        outputs: [output(datum(0, 0)), ..tx.outputs],
      },
      liquidity_policy,
    )
}

fn consolidation() -> transaction.Transaction {
  let donor = retirement(1, 20)
  transaction.Transaction {
    ..donor,
    inputs: [input(0, 10), input(1, 20)],
    outputs: [output(datum(0, 30)), ..donor.outputs],
  }
}

test liquidity_consolidation_preserves_principal_and_refunds_donor_reserve() {
  let tx = consolidation()
  liquidity.consolidate(
    tx.inputs,
    tx,
    liquidity_policy,
    input(0, 10).output_reference,
  )
}

test liquidity_consolidation_cannot_take_principal() fail {
  let tx = consolidation()
  let donor = retirement(1, 20)
  liquidity.consolidate(
    tx.inputs,
    transaction.Transaction {
      ..tx,
      outputs: [output(datum(0, 29)), ..donor.outputs],
    },
    liquidity_policy,
    input(0, 10).output_reference,
  )
}
