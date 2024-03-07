use aiken/interval.{Finite, Interval, IntervalBound, PositiveInfinity}
use aiken/transaction.{
  Datum, DatumHash, InlineDatum, Input, Mint, NoDatum, Output, OutputReference,
  Publish, ScriptContext, Spend, Transaction, TransactionId, ValidityRange,
  WithdrawFrom,
}
use aiken/transaction/certificate.{CredentialRegistration}
use aiken/transaction/credential.{Inline, ScriptCredential}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

const hash_sample =
  #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"

const hash_sample_second =
  #"d8bba054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"

test test_quantity_token_output() {
  let mock_policy_id = #"786a02f742015903c6c6fd852552d272912f4740e1584761"
  let mock_asset_name = "handler"
  let mock_outputs: List<Output> =
    [
      Output {
        address: credential.from_script(hash_sample),
        value: value.from_asset(mock_policy_id, mock_asset_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: credential.from_script(hash_sample),
        value: value.from_asset(mock_policy_id, mock_asset_name, 2),
        datum: NoDatum,
        reference_script: None,
      },
      Output {
        address: credential.from_script(hash_sample),
        value: value.from_asset(mock_policy_id, mock_asset_name, 3),
        datum: NoDatum,
        reference_script: None,
      },
    ]
  validator_utils.quantity_token_output(
    mock_outputs,
    mock_policy_id,
    mock_asset_name,
  ) == 6
}

test test_quantity_token_input() {
  let mock_policy_id = #"786a02f742015903c6c6fd852552d272912f4740e1584761"
  let mock_asset_name = "handler"
  let mock_inputs: List<Input> =
    [
      Input {
        output_reference: OutputReference {
          transaction_id: TransactionId(hash_sample),
          output_index: 0,
        },
        output: Output {
          address: credential.from_script(hash_sample),
          value: value.from_asset(mock_policy_id, mock_asset_name, 1),
          datum: NoDatum,
          reference_script: None,
        },
      },
      Input {
        output_reference: OutputReference {
          transaction_id: TransactionId(hash_sample),
          output_index: 1,
        },
        output: Output {
          address: credential.from_script(hash_sample),
          value: value.from_asset(mock_policy_id, mock_asset_name, 2),
          datum: NoDatum,
          reference_script: None,
        },
      },
    ]
  validator_utils.quantity_token_input(
    mock_inputs,
    mock_policy_id,
    mock_asset_name,
  ) == 3
}

test test_get_tx_valid_to_succeed() {
  let expected_valid_to = 10
  let mock_validity_range: ValidityRange =
    Interval {
      lower_bound: IntervalBound { bound_type: Finite(1), is_inclusive: True },
      upper_bound: IntervalBound { bound_type: Finite(10), is_inclusive: True },
    }
  validator_utils.get_tx_valid_to(mock_validity_range) == expected_valid_to
}

test test_get_tx_valid_to_failed_with_upper_bound_is_not_inclusive() fail {
  let expected_valid_to = 10
  let mock_validity_range: ValidityRange =
    Interval {
      lower_bound: IntervalBound { bound_type: Finite(1), is_inclusive: True },
      upper_bound: IntervalBound { bound_type: Finite(10), is_inclusive: False },
    }
  validator_utils.get_tx_valid_to(mock_validity_range) == expected_valid_to
}

test test_get_tx_valid_to_failed_with_upper_bound_is_infinity() fail {
  let expected_valid_to = 10
  let mock_validity_range: ValidityRange =
    Interval {
      lower_bound: IntervalBound { bound_type: Finite(1), is_inclusive: True },
      upper_bound: IntervalBound {
        bound_type: PositiveInfinity,
        is_inclusive: False,
      },
    }
  validator_utils.get_tx_valid_to(mock_validity_range) == expected_valid_to
}

// Test for successfully extracting minting context in case purpose is mint
test extract_minting_context_succeed() {
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }
  let policy_id: PolicyId = hash_sample
  let purpose = Mint(policy_id)
  let script_context = ScriptContext { transaction, purpose }
  validator_utils.extract_minting_context(script_context) == (
    policy_id,
    [input],
    [output],
    mint,
  )
}

// Test for failing to extract minting context when purpose is spend
test extract_minting_context_fail_when_purpose_is_spend() fail {
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }
  let purpose = Spend(input.output_reference)
  let script_context = ScriptContext { transaction, purpose }
  validator_utils.extract_minting_context(script_context) == (
    hash_sample,
    [input],
    [output],
    mint,
  )
}

// Test for failing to extract minting context when purpose is withdraw_from
test extract_minting_context_fail_when_purpose_is_withdraw_from() fail {
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }
  let credential = ScriptCredential(hash_sample)
  let stake_credential = Inline(credential)
  let purpose = WithdrawFrom(stake_credential)

  let Transaction { inputs, outputs, mint, .. } = transaction
  let script_context = ScriptContext { transaction, purpose }
  validator_utils.extract_minting_context(script_context) == (
    hash_sample,
    inputs,
    outputs,
    mint,
  )
}

// Test for failing to extract minting context when purpose is publish
test extract_minting_context_fail_when_purpose_is_publish() fail {
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }
  let credential = ScriptCredential(hash_sample)
  let stake_credential = Inline(credential)
  let certificate = CredentialRegistration(stake_credential)
  let purpose = Publish(certificate)
  let Transaction { inputs, outputs, mint, .. } = transaction
  let script_context = ScriptContext { transaction, purpose }
  validator_utils.extract_minting_context(script_context) == (
    hash_sample,
    inputs,
    outputs,
    mint,
  )
}

// Test for successfully getting inline datum from an output
test get_inline_datum_succeed() {
  let datum = InlineDatum(hash_sample)
  let output = create_output_sample(datum)
  expect data: ByteArray = validator_utils.get_inline_datum(output)
  data == hash_sample
}

// Test for failing to get inline datum when the output has NoDatum
test get_inline_datum_fail_when_no_datum() fail {
  let invalid_datum = NoDatum
  let output = create_output_sample(invalid_datum)
  expect data: ByteArray = validator_utils.get_inline_datum(output)
  data == hash_sample
}

// Test for failing to get inline datum when the output has DatumHash
test get_inline_datum_fail_when_datum_hash() fail {
  let invalid_datum = DatumHash(hash_sample)
  let output = create_output_sample(invalid_datum)
  expect data: ByteArray = validator_utils.get_inline_datum(output)
  data == hash_sample
}

test test_extract_spending_context_succeed() {
  // Define sample data for the transaction
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let mock_transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }

  // Define the purpose as Spend, representing a spending operation
  let purpose = Spend(input.output_reference)

  // Create the script context using the mock transaction and purpose
  let script_context = ScriptContext { transaction: mock_transaction, purpose }

  // Call the function under test
  let (spent_output, transaction) =
    validator_utils.extract_spending_context(script_context)

  // Assert that the output and transaction match the mock data
  spent_output == input.output && transaction == mock_transaction
}

test test_extract_spending_context_fail_when_spent_ref_differs_from_input_output_ref() fail {
  // Define sample data for the transaction
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let mock_transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }

  // Define the purpose as Spend, representing a spending operation
  let purpose = Spend(OutputReference(TransactionId(hash_sample_second), 0))

  // Create the script context using the mock transaction and purpose
  let script_context = ScriptContext { transaction: mock_transaction, purpose }

  // Call the function under test
  let (spent_output, transaction) =
    validator_utils.extract_spending_context(script_context)

  // Assert that the output and transaction match the mock data
  spent_output == input.output && transaction == mock_transaction
}

test test_extract_spending_context_fail_when_purpose_is_withdraw_from() fail {
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let mock_transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }

  // Define the purpose as WithdrawFrom, representing a withdrawal operation
  let stake_credential = Inline(ScriptCredential(hash_sample))
  let purpose = WithdrawFrom(stake_credential)

  // Create the script context using the mock transaction and purpose
  let script_context = ScriptContext { transaction: mock_transaction, purpose }

  // Call the function under test
  let (spent_output, transaction) =
    validator_utils.extract_spending_context(script_context)

  // Assert that the output and transaction match the mock data
  spent_output == input.output && transaction == mock_transaction
}

test test_extract_spending_context_when_purpose_is_mint_purpose() fail {
  // Define sample data for the transaction
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }
  let policy_id: PolicyId = hash_sample
  let purpose = Mint(policy_id)
  // Create the script context using the mock transaction and purpose
  let script_context = ScriptContext { transaction, purpose }
  // Call the function under test
  let (spent_output, transaction_result) =
    validator_utils.extract_spending_context(script_context)
  spent_output == input.output && transaction_result == transaction
}

test test_extract_spending_context_when_purpose_is_publish() fail {
  // Define sample data for the transaction
  let (input, output) = create_sample_data_input_output()
  let mint = value.to_minted_value(value.zero())
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [input],
      outputs: [output],
      mint: mint,
    }
  let credential = ScriptCredential(hash_sample)
  let stake_credential = Inline(credential)
  let certificate = CredentialRegistration(stake_credential)
  let purpose = Publish(certificate)
  let script_context = ScriptContext { transaction, purpose }
  // Call the function under test
  let (spent_output, transaction_result) =
    validator_utils.extract_spending_context(script_context)
  spent_output == input.output && transaction_result == transaction
}

fn create_sample_data_input_output() -> (Input, Output) {
  let transaction_id = TransactionId(hash_sample)
  let output = create_output_sample(NoDatum)
  let input =
    Input { output_reference: OutputReference(transaction_id, 0), output }
  (input, output)
}

fn create_output_sample(datum: Datum) -> Output {
  let output =
    Output {
      address: credential.from_script(hash_sample),
      value: value.zero(),
      datum,
      reference_script: None,
    }
  output
}

test test_validate_mint_succeed() {
  // Mock inputs
  let mock_minting_policy_id =
    #"ae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de1472"
  let mock_minting_token_name = #"68616e646c6572"
  let token_name_prefix = #"6368616e6e656c"
  let sequence = 0

  let handler_token =
    AuthToken {
      policy_id: mock_minting_policy_id,
      name: mock_minting_token_name,
    }
  //get token name
  let token_name =
    auth.generate_token_name(handler_token, token_name_prefix, sequence)
  let mint =
    value.to_minted_value(
      value.from_asset(
        policy_id: mock_minting_policy_id,
        asset_name: token_name,
        quantity: 1,
      ),
    )
  // Call the function under test
  let result =
    validator_utils.validate_mint(
      mint,
      mock_minting_policy_id,
      handler_token,
      token_name_prefix,
      sequence,
    )
  // Assert that the result is as expected
  result == Some(AuthToken { ..handler_token, name: token_name })
}

test test_validate_mint_fail_when_mint_value_not_contains_auth_token() fail {
  // Mock inputs
  let mock_minting_policy_id =
    #"ae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de1472"
  let mock_minting_token_name = #"68616e646c6572"
  let token_name_prefix = #"6368616e6e656c"
  let sequence = 0

  let handler_token =
    AuthToken {
      policy_id: mock_minting_policy_id,
      name: mock_minting_token_name,
    }
  //get token name
  let token_name =
    auth.generate_token_name(handler_token, token_name_prefix, sequence)
  let mint =
    value.to_minted_value(
      value.from_asset(
        policy_id: mock_minting_policy_id,
        asset_name: token_name,
        quantity: 0,
      ),
    )
  // Call the function under test
  let result =
    validator_utils.validate_mint(
      mint,
      mock_minting_policy_id,
      handler_token,
      token_name_prefix,
      sequence,
    )
  // Assert that the result is as expected
  result == Some(AuthToken { ..handler_token, name: token_name })
}
