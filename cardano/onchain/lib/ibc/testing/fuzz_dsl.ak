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

// Lightweight semantic fixture for helper-level and contract-level properties.
// It records the transition being exercised, the mutation being applied, and
// the validator checks that should collectively accept or reject the fixture.
pub type TxFixture {
  TxFixture {
    model: ModelState,
    mutation: Mutation,
    checks: List<ValidatorCheck>,
  }
}

// A transaction context for explicitly selected helper or handler checks.
// The assertions below only inspect the supplied Boolean results. They do not
// dispatch Mint/Spend purposes or prove that every required script was run.
// Complete transaction properties live in offchain/src/testing/transaction-fuzz.ts.
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
  // Start from an empty transaction-shaped fixture so tests can pipe in only
  // the inputs, outputs, redeemers, and checks relevant to one transition.
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
  // Use this when a test already builds a concrete Transaction and wants the
  // DSL outcome helpers without reconstructing each transaction field by hand.
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
  // Mutations should represent exactly one near-valid difference. That makes a
  // failing assertion actionable: one protocol guard accepted one bad change.
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

pub fn all_checks_accept(fixture: TxFixture) -> Bool {
  // Empty check lists are rejected so a valid fixture cannot accidentally pass
  // without executing any contract predicate.
  and {
    !list.is_empty(fixture.checks),
    list.all(fixture.checks, fn(check) { check.accepted }),
  }
}

pub fn any_check_rejects(fixture: TxFixture) -> Bool {
  // Rejection properties only need one relevant validator to reject the
  // mutation, matching how a composed transaction fails on-chain.
  and {
    !list.is_empty(fixture.checks),
    list.any(fixture.checks, fn(check) { !check.accepted }),
  }
}

pub fn all_protocol_checks_accept(fixture: ProtocolTxFixture) -> Bool {
  and {
    !list.is_empty(fixture.checks),
    list.all(fixture.checks, fn(check) { check.accepted }),
  }
}

pub fn any_protocol_check_rejects(fixture: ProtocolTxFixture) -> Bool {
  and {
    !list.is_empty(fixture.checks),
    list.any(fixture.checks, fn(check) { !check.accepted }),
  }
}

pub fn expect_outcome(fixture: TxFixture, expected: ExpectedOutcome) -> Bool {
  when expected is {
    Accept -> all_checks_accept(fixture)
    Reject -> any_check_rejects(fixture)
  }
}

pub fn expect_protocol_outcome(
  fixture: ProtocolTxFixture,
  expected: ExpectedOutcome,
) -> Bool {
  when expected is {
    Accept -> all_protocol_checks_accept(fixture)
    Reject -> any_protocol_check_rejects(fixture)
  }
}

pub fn assert_valid(fixture: TxFixture) -> Bool {
  expect_outcome(fixture, Accept)
}

pub fn assert_rejected(fixture: TxFixture) -> Bool {
  expect_outcome(fixture, Reject)
}

pub fn assert_protocol_checks_accept(fixture: ProtocolTxFixture) -> Bool {
  expect_protocol_outcome(fixture, Accept)
}

pub fn assert_protocol_checks_reject(fixture: ProtocolTxFixture) -> Bool {
  expect_protocol_outcome(fixture, Reject)
}
