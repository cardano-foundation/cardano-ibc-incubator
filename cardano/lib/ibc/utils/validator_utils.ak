use aiken/dict.{Dict}
use aiken/interval.{Finite}
use aiken/list
use aiken/time.{PosixTime}
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, Redeemer, ScriptContext, ScriptPurpose,
  Spend, Transaction, ValidityRange,
}
use aiken/transaction/value.{AssetName, MintedValue, PolicyId}

pub fn get_inline_datum(output: Output) -> Data {
  expect InlineDatum(data) = output.datum
  data
}

pub fn extract_minting_context(
  context: ScriptContext,
) -> (ByteArray, List<Input>, List<Output>, MintedValue) {
  let ScriptContext { transaction, purpose } = context
  expect Mint(policy_id) = purpose
  let Transaction { inputs, outputs, mint, .. } = transaction
  (policy_id, inputs, outputs, mint)
}

pub fn extract_spending_context(
  context: ScriptContext,
) -> (Output, List<Input>, List<Output>, Dict<ScriptPurpose, Redeemer>) {
  let ScriptContext { transaction, purpose } = context
  let Transaction { inputs, outputs, redeemers, .. } = transaction

  expect Spend(spent_ref) = purpose
  let spent_input = inputs |> transaction.find_input(spent_ref)
  expect Some(spent_input) = spent_input

  let spent_output = spent_input.output

  (spent_output, inputs, outputs, redeemers)
}

pub fn quantity_token_output(
  outputs: List<Output>,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  outputs
    |> list.reduce(
         0,
         fn(prev, cur) {
           prev + (
             cur.value
               |> value.quantity_of(policy_id, asset_name)
           )
         },
       )
}

pub fn quantity_token_input(
  inputs: List<Input>,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  inputs
    |> list.map(fn(input) { input.output })
    |> quantity_token_output(policy_id, asset_name)
}

pub fn get_tx_valid_to(validity_range: ValidityRange) -> PosixTime {
  let upper_bound = validity_range.upper_bound

  expect upper_bound.is_inclusive

  expect Finite(valid_to) = upper_bound.bound_type

  valid_to
}
