use cardano/assets.{Value}
use cardano/transaction.{Input, Output}

// Checks that a state output changes by exactly `additional_value`.
// Lovelace may be overpaid to satisfy minimum-ADA requirements.
pub fn validate_output_amount(
  locked_input: Input,
  output: Output,
  additional_value: Value,
) -> Bool {
  let expected_output =
    locked_input.output.value
      |> assets.merge(additional_value)

  validate_output_value(output, expected_output)
}

pub fn validate_output_value(output: Output, expected_output: Value) -> Bool {
  and {
    assets.lovelace_of(output.value) >= assets.lovelace_of(expected_output),
    assets.without_lovelace(output.value) == assets.without_lovelace(
      expected_output,
    ),
  }
}
