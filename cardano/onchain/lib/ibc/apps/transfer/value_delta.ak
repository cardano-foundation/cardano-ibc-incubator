use cardano/assets.{Value}
use cardano/transaction.{Input, Output}

// Checks that a state output changes by exactly `additional_value`.
// Lovelace may be overpaid to satisfy minimum-ADA requirements.
pub fn validate_output_amount(
  locked_input: Input,
  output: Output,
  additional_value: Value,
) -> Bool {
  let lovelace_input = assets.lovelace_of(locked_input.output.value)
  trace @"lovelace_input": lovelace_input

  trace @"additional_value": additional_value

  let lovelace_output = assets.lovelace_of(output.value)
  trace @"lovelace_output": lovelace_output

  let expected_output =
    locked_input.output.value
      |> assets.merge(additional_value)

  validate_output_value(output, expected_output)
}

pub fn validate_output_value(output: Output, expected_output: Value) -> Bool {
  let lovelace_output = assets.lovelace_of(output.value)
  let expected_lovelace_output = assets.lovelace_of(expected_output)
  trace @"expected_lovelace_output": expected_lovelace_output
  and {
    (lovelace_output >= expected_lovelace_output)?,
    assets.match_assets(output.value, expected_output)?,
  }
}
