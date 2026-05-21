use aiken/collection/dict.{Dict}
use aiken/collection/list
use aiken/crypto.{DataHash}
use cardano/assets.{Value}
use cardano/transaction.{
  Input, Output, Redeemer, ScriptPurpose, Transaction, placeholder,
}

pub type ExpectedOutcome {
  Accept
  Reject
}

pub type ModelState {
  ModelState { protocol: ByteArray, transition: ByteArray }
}

pub type Mutation {
  NoMutation
  Mutation { name: ByteArray }
}

pub type ValidatorCheck {
  ValidatorCheck { name: ByteArray, accepted: Bool }
}

pub type TxFixture {
  TxFixture {
    model: ModelState,
    mutation: Mutation,
    checks: List<ValidatorCheck>,
  }
}

pub type ProtocolTxFixture {
  ProtocolTxFixture {
    inputs: List<Input>,
    reference_inputs: List<Input>,
    outputs: List<Output>,
    mint: Value,
    redeemers: Pairs<ScriptPurpose, Redeemer>,
    datums: Dict<DataHash, Data>,
    model_before: ModelState,
    model_after: ModelState,
    mutation: Mutation,
    checks: List<ValidatorCheck>,
  }
}

pub fn model(protocol: ByteArray, transition: ByteArray) -> ModelState {
  ModelState { protocol, transition }
}

pub fn no_mutation() -> Mutation {
  NoMutation
}

pub fn mutation(name: ByteArray) -> Mutation {
  Mutation { name }
}

pub fn fixture(model: ModelState, mutation: Mutation) -> TxFixture {
  TxFixture { model, mutation, checks: [] }
}

pub fn protocol_tx_fixture(
  model_before: ModelState,
  model_after: ModelState,
  mutation: Mutation,
) -> ProtocolTxFixture {
  ProtocolTxFixture {
    inputs: [],
    reference_inputs: [],
    outputs: [],
    mint: placeholder.mint,
    redeemers: [],
    datums: placeholder.datums,
    model_before,
    model_after,
    mutation,
    checks: [],
  }
}

pub fn protocol_tx_from_transaction(
  model_before: ModelState,
  model_after: ModelState,
  mutation: Mutation,
  transaction: Transaction,
) -> ProtocolTxFixture {
  ProtocolTxFixture {
    inputs: transaction.inputs,
    reference_inputs: transaction.reference_inputs,
    outputs: transaction.outputs,
    mint: transaction.mint,
    redeemers: transaction.redeemers,
    datums: transaction.datums,
    model_before,
    model_after,
    mutation,
    checks: [],
  }
}

pub fn check_fixture(
  model: ModelState,
  mutation: Mutation,
  check_name: ByteArray,
  accepted: Bool,
) -> TxFixture {
  fixture(model, mutation)
    |> with_validator_check(check_name, accepted)
}

pub fn valid_check(
  protocol: ByteArray,
  transition: ByteArray,
  check_name: ByteArray,
  accepted: Bool,
) -> TxFixture {
  check_fixture(
    model(protocol, transition),
    no_mutation(),
    check_name,
    accepted,
  )
}

pub fn mutated_check(
  protocol: ByteArray,
  transition: ByteArray,
  mutation_name: ByteArray,
  check_name: ByteArray,
  accepted: Bool,
) -> TxFixture {
  check_fixture(
    model(protocol, transition),
    mutation(mutation_name),
    check_name,
    accepted,
  )
}

pub fn valid_fixture(model: ModelState) -> TxFixture {
  fixture(model, no_mutation())
}

pub fn with_mutation(fixture: TxFixture, mutation: Mutation) -> TxFixture {
  TxFixture { ..fixture, mutation }
}

pub fn with_validator_check(
  fixture: TxFixture,
  name: ByteArray,
  accepted: Bool,
) -> TxFixture {
  TxFixture {
    ..fixture,
    checks: [ValidatorCheck { name, accepted }, ..fixture.checks],
  }
}

pub fn with_input(fixture: ProtocolTxFixture, input: Input) -> ProtocolTxFixture {
  ProtocolTxFixture { ..fixture, inputs: [input, ..fixture.inputs] }
}

pub fn with_reference_input(
  fixture: ProtocolTxFixture,
  input: Input,
) -> ProtocolTxFixture {
  ProtocolTxFixture {
    ..fixture,
    reference_inputs: [input, ..fixture.reference_inputs],
  }
}

pub fn with_output(
  fixture: ProtocolTxFixture,
  output: Output,
) -> ProtocolTxFixture {
  ProtocolTxFixture { ..fixture, outputs: [output, ..fixture.outputs] }
}

pub fn with_mint(fixture: ProtocolTxFixture, mint: Value) -> ProtocolTxFixture {
  ProtocolTxFixture { ..fixture, mint }
}

pub fn with_redeemer(
  fixture: ProtocolTxFixture,
  purpose: ScriptPurpose,
  redeemer: Redeemer,
) -> ProtocolTxFixture {
  ProtocolTxFixture {
    ..fixture,
    redeemers: [Pair(purpose, redeemer), ..fixture.redeemers],
  }
}

pub fn with_protocol_validator_check(
  fixture: ProtocolTxFixture,
  name: ByteArray,
  accepted: Bool,
) -> ProtocolTxFixture {
  ProtocolTxFixture {
    ..fixture,
    checks: [ValidatorCheck { name, accepted }, ..fixture.checks],
  }
}

pub fn to_transaction(fixture: ProtocolTxFixture) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: fixture.inputs,
    reference_inputs: fixture.reference_inputs,
    outputs: fixture.outputs,
    mint: fixture.mint,
    redeemers: fixture.redeemers,
    datums: fixture.datums,
  }
}

pub fn run_all_relevant_validators(fixture: TxFixture) -> Bool {
  and {
    !list.is_empty(fixture.checks),
    list.all(fixture.checks, fn(check) { check.accepted }),
  }
}

pub fn run_any_relevant_validator_rejected(fixture: TxFixture) -> Bool {
  and {
    !list.is_empty(fixture.checks),
    list.any(fixture.checks, fn(check) { !check.accepted }),
  }
}

pub fn run_all_protocol_validators(fixture: ProtocolTxFixture) -> Bool {
  and {
    !list.is_empty(fixture.checks),
    list.all(fixture.checks, fn(check) { check.accepted }),
  }
}

pub fn run_any_protocol_validator_rejected(fixture: ProtocolTxFixture) -> Bool {
  and {
    !list.is_empty(fixture.checks),
    list.any(fixture.checks, fn(check) { !check.accepted }),
  }
}

pub fn expect_outcome(fixture: TxFixture, expected: ExpectedOutcome) -> Bool {
  when expected is {
    Accept -> run_all_relevant_validators(fixture)
    Reject -> run_any_relevant_validator_rejected(fixture)
  }
}

pub fn expect_protocol_outcome(
  fixture: ProtocolTxFixture,
  expected: ExpectedOutcome,
) -> Bool {
  when expected is {
    Accept -> run_all_protocol_validators(fixture)
    Reject -> run_any_protocol_validator_rejected(fixture)
  }
}

pub fn assert_valid(fixture: TxFixture) -> Bool {
  expect_outcome(fixture, Accept)
}

pub fn assert_rejected(fixture: TxFixture) -> Bool {
  expect_outcome(fixture, Reject)
}

pub fn assert_protocol_valid(fixture: ProtocolTxFixture) -> Bool {
  expect_protocol_outcome(fixture, Accept)
}

pub fn assert_protocol_rejected(fixture: ProtocolTxFixture) -> Bool {
  expect_protocol_outcome(fixture, Reject)
}
