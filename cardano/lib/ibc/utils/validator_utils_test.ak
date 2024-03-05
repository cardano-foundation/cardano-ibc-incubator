use aiken/interval.{Finite, Interval, IntervalBound, PositiveInfinity}
use aiken/transaction.{
  Datum, DatumHash, InlineDatum, Input, Mint, NoDatum, Output, OutputReference,
  Publish, ScriptContext, Spend, Transaction, TransactionId, ValidityRange,
  WithdrawFrom,
}
use aiken/transaction/certificate.{CredentialRegistration}
use aiken/transaction/credential.{Inline, ScriptCredential}
use aiken/transaction/value.{MintedValue, PolicyId}
use ibc/utils/validator_utils

const hash_sample =
  #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"

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
  let (inputs, outputs, mint) = create_sample_data_for_minting_context()
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      mint: mint,
    }
  let policy_id: PolicyId = hash_sample
  let purpose = Mint(policy_id)
  let script_context = ScriptContext { transaction, purpose }
  validator_utils.extract_minting_context(script_context) == (
    policy_id,
    inputs,
    outputs,
    mint,
  )
}

// Test for failing to extract minting context when purpose is spend
test extract_minting_context_fail_when_purpose_is_spend() fail {
  let (inputs, outputs, mint) = create_sample_data_for_minting_context()
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
      mint: mint,
    }
  let transaction_id = TransactionId(hash_sample)
  let purpose = Spend(OutputReference(transaction_id, 1))
  let Transaction { inputs, outputs, mint, .. } = transaction
  let script_context = ScriptContext { transaction, purpose }
  validator_utils.extract_minting_context(script_context) == (
    hash_sample,
    inputs,
    outputs,
    mint,
  )
}

// Test for failing to extract minting context when purpose is withdraw_from
test extract_minting_context_fail_when_purpose_is_withdraw_from() fail {
  let (inputs, outputs, mint) = create_sample_data_for_minting_context()
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
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
  let (inputs, outputs, mint) = create_sample_data_for_minting_context()
  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: inputs,
      outputs: outputs,
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

fn create_sample_data_for_minting_context() -> (
  List<Input>,
  List<Output>,
  MintedValue,
) {
  let transaction_id = TransactionId(hash_sample)
  let output = create_output_sample(NoDatum)
  let inputs =
    [Input { output_reference: OutputReference(transaction_id, 1), output }]
  let mint = value.to_minted_value(value.zero())
  let outputs =
    [output]
  (inputs, outputs, mint)
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
