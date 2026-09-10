use aiken/cbor
use aiken/collection/list
use aiken/interval
use cardano/address.{Script, from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction, Withdraw,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  CheckClientHistory, RecoverClientWithdrawal, RecoverClientWithdrawalRedeemer,
  SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/header.{Header} as header_mod
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/client/ics_007_tendermint_client/test_fixtures/tendermint_update_capacity.{
  adjacent_all_signed_spend_client_redeemer_cbor,
  adjacent_all_signed_trusted_app_hash, adjacent_all_signed_trusted_timestamp,
  adjacent_all_signed_trusted_validator_set_hash,
  adjacent_mixed_spend_client_redeemer_cbor, adjacent_mixed_trusted_app_hash,
  adjacent_mixed_trusted_timestamp, adjacent_mixed_trusted_validator_set_hash,
  non_adjacent_mixed_spend_client_redeemer_cbor,
  non_adjacent_mixed_trusted_app_hash, non_adjacent_mixed_trusted_timestamp,
  non_adjacent_mixed_trusted_validator_set_hash,
}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_025_handler_interface/host_state_redeemer
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use recover_client
use spending_client

type MockData {
  host_state_nft_policy_id: PolicyId,
  host_state_input: Input,
  host_state_output: Output,
  client_token: AuthToken,
  output_reference: OutputReference,
  input: Input,
}

// Historical signed-header fixtures use the previous one-field redeemer.
// Decode only that fixture envelope and construct the production ABI below.

type CapacityFixture {
  host_state_nft_policy_id: PolicyId,
  datum: Option<ClientDatum>,
  redeemer: SpendClientRedeemer,
  output_reference: OutputReference,
  transaction: Transaction,
}

fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn full_empty_siblings() -> List<ByteArray> {
  repeat_bytearray(
    ibc_state_commitment.empty_hash,
    ibc_state_commitment.merkle_depth_bits,
  )
}

fn setup() -> MockData {
  let host_state_nft_policy_id: PolicyId =
    #"11111111111111111111111111111111111111111111111111111111"
  let host_state_output_reference =
    OutputReference {
      transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
      output_index: 0,
    }
  let host_state_output =
    Output {
      address: from_script(
        #"33333333333333333333333333333333333333333333333333333333",
      ),
      value: from_asset(host_state_nft_policy_id, "ibc_host_state", 1),
      datum: InlineDatum(Void),
      reference_script: None,
    }
  let host_state_input =
    Input {
      output_reference: host_state_output_reference,
      output: host_state_output,
    }
  let client_token =
    AuthToken {
      policy_id: #"44444444444444444444444444444444444444444444444444444444",
      name: "08-tendermint-0",
    }
  let output_reference =
    OutputReference {
      transaction_id: #"5555555555555555555555555555555555555555555555555555555555555555",
      output_index: 0,
    }
  let input =
    Input {
      output_reference,
      output: Output {
        address: from_script(
          #"66666666666666666666666666666666666666666666666666666666",
        ),
        value: from_asset(client_token.policy_id, client_token.name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  MockData {
    host_state_nft_policy_id,
    host_state_input,
    host_state_output,
    client_token,
    output_reference,
    input,
  }
}

fn update_client_output_datum(
  client_datum: ClientDatum,
  output: Output,
) -> Output {
  Output { ..output, datum: InlineDatum(client_datum) }
}

fn prepare_update_client_capacity(
  encoded_redeemer: ByteArray,
  trusted_timestamp: Int,
  trusted_app_hash: ByteArray,
  trusted_validator_set_hash: ByteArray,
) -> CapacityFixture {
  let mock = setup()
  expect Some(data) = cbor.deserialise(encoded_redeemer)
  expect UpdateClient {
    msg: HeaderCase(header),
    history_witnesses,
    history_siblings,
  }: SpendClientRedeemer = data
  expect history_witnesses == []
  expect history_siblings == full_empty_siblings()
  let redeemer =
    UpdateClient {
      msg: HeaderCase(header),
      history_witnesses: [],
      history_siblings: full_empty_siblings(),
    }

  let client_state =
    ClientState {
      chain_id: "injective-1",
      trust_level: unchecked_rational.new(1, 3),
      trusting_period: 1_209_600_000_000_000,
      unbonding_period: 1_814_400_000_000_000,
      max_clock_drift: 10_000_000_000,
      frozen_height: Height { revision_number: 0, revision_height: 0 },
      latest_height: header.trusted_height,
      proof_specs: [],
    }
  let consensus_state =
    ConsensusState {
      timestamp: trusted_timestamp,
      next_validators_hash: trusted_validator_set_hash,
      root: merkle.new_merkle_root(trusted_app_hash),
    }
  let consensus_states = [Pair(header.trusted_height, consensus_state)]
  let client_datum =
    ClientDatum {
      history_root: #"0000000000000000000000000000000000000000000000000000000000000000",
      state: ClientDatumState {
        client_state,
        consensus_states,
        processed_times: [Pair(header.trusted_height, 0)],
        processed_heights: [Pair(header.trusted_height, 0)],
      },
      token: mock.client_token,
    }
  let client_input =
    Input {
      ..mock.input,
      output: update_client_output_datum(client_datum, mock.input.output),
    }
  let header_height = header_mod.get_height(header)
  let processed_time =
    ( ( trusted_timestamp + client_state.trusting_period ) / 1_000_000 - 1000 ) * 1_000_000
  let updated_datum =
    ClientDatum {
      ..client_datum,
      history_root: consensus_history.insert(
        client_datum.history_root,
        consensus_history.from_client(client_datum),
        full_empty_siblings(),
      ),
      state: ClientDatumState {
        client_state: ClientState {
          ..client_state,
          latest_height: header_height,
        },
        consensus_states: [
          Pair(header_height, header_mod.consensus_state(header)),
        ],
        processed_times: [Pair(header_height, processed_time)],
        processed_heights: [
          Pair(
            header_height,
            client_datum_mod.processed_height_from_time(processed_time),
          ),
        ],
      },
    }
  let outputs =
    [
      update_client_output_datum(updated_datum, client_input.output),
      mock.host_state_output,
    ]
  let validity_range =
    interval.between(
      ( header.signed_header.header.time - client_state.max_clock_drift ) / 1_000_000 + 1000,
      ( trusted_timestamp + client_state.trusting_period ) / 1_000_000 - 1000,
    )
  let siblings = full_empty_siblings()
  let host_state_redeemer: Redeemer =
    host_state_redeemer.UpdateClient {
      client_state_siblings: siblings,
      consensus_state_siblings: siblings,
    }
  let host_state_redeemers: Pairs<ScriptPurpose, Redeemer> =
    [Pair(Spend(mock.host_state_input.output_reference), host_state_redeemer)]
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [client_input, mock.host_state_input],
      outputs,
      validity_range,
      redeemers: host_state_redeemers,
    }

  CapacityFixture {
    host_state_nft_policy_id: mock.host_state_nft_policy_id,
    datum: Some(client_datum),
    redeemer,
    output_reference: mock.output_reference,
    transaction,
  }
}

// Decode and build ledger arguments at compile time, outside measured execution.
const adjacent_all_signed_fixture =
  prepare_update_client_capacity(
    adjacent_all_signed_spend_client_redeemer_cbor,
    adjacent_all_signed_trusted_timestamp,
    adjacent_all_signed_trusted_app_hash,
    adjacent_all_signed_trusted_validator_set_hash,
  )

const adjacent_mixed_fixture =
  prepare_update_client_capacity(
    adjacent_mixed_spend_client_redeemer_cbor,
    adjacent_mixed_trusted_timestamp,
    adjacent_mixed_trusted_app_hash,
    adjacent_mixed_trusted_validator_set_hash,
  )

const non_adjacent_mixed_fixture =
  prepare_update_client_capacity(
    non_adjacent_mixed_spend_client_redeemer_cbor,
    non_adjacent_mixed_trusted_timestamp,
    non_adjacent_mixed_trusted_app_hash,
    non_adjacent_mixed_trusted_validator_set_hash,
  )

fn check_update_client_capacity(fixture: CapacityFixture) -> Bool {
  check_capacity_component(fixture, None)
}

fn check_capacity_component(
  fixture: CapacityFixture,
  support_only: Option<Bool>,
) -> Bool {
  expect Some(client) = fixture.datum
  let credential = Script("mock recover client script hash")
  let support = CheckClientHistory { subject_token: client.token }
  let raw_support: Redeemer = support
  let raw_spend: Redeemer = fixture.redeemer
  let supported =
    Transaction {
      ..fixture.transaction,
      withdrawals: [Pair(credential, 0)],
      redeemers: [
        Pair(Withdraw(credential), raw_support),
        Pair(Spend(fixture.output_reference), raw_spend),
        ..fixture.transaction.redeemers
      ],
    }
  let spend =
    fn() {
      spending_client.spend_client.spend(
        fixture.host_state_nft_policy_id,
        Script("mock recover client script hash"),
        fixture.datum,
        fixture.redeemer,
        fixture.output_reference,
        supported,
      )
    }
  let support_check =
    fn() {
      recover_client.recover_client.withdraw(
        fixture.host_state_nft_policy_id,
        support,
        credential,
        supported,
      )
    }
  when support_only is {
    None -> and {
        spend(),
        support_check(),
      }
    Some(True) -> support_check()
    Some(False) -> spend()
  }
}

test update_client_capacity_adjacent_all_signed_45_succeeds() {
  check_capacity_component(adjacent_all_signed_fixture, Some(False))
}

test update_client_capacity_adjacent_mixed_45_succeeds() {
  check_capacity_component(adjacent_mixed_fixture, Some(False))
}

test update_client_capacity_non_adjacent_mixed_45_succeeds() {
  check_capacity_component(non_adjacent_mixed_fixture, Some(False))
}

test support_capacity_adjacent_all_signed_45_succeeds() {
  check_capacity_component(adjacent_all_signed_fixture, Some(True))
}

test support_capacity_adjacent_mixed_45_succeeds() {
  check_capacity_component(adjacent_mixed_fixture, Some(True))
}

test support_capacity_non_adjacent_mixed_45_succeeds() {
  check_capacity_component(non_adjacent_mixed_fixture, Some(True))
}

test advancing_update_rejects_missing_history_insertion_proof() fail {
  let fixture = adjacent_all_signed_fixture
  expect UpdateClient { msg, history_witnesses, .. } = fixture.redeemer
  check_update_client_capacity(
    CapacityFixture {
      ..fixture,
      redeemer: UpdateClient { msg, history_witnesses, history_siblings: [] },
    },
  )
}

fn with_output_datum(
  fixture: CapacityFixture,
  datum: ClientDatum,
) -> CapacityFixture {
  expect [output, host] = fixture.transaction.outputs
  CapacityFixture {
    ..fixture,
    transaction: Transaction {
      ..fixture.transaction,
      outputs: [Output { ..output, datum: InlineDatum(datum) }, host],
    },
  }
}

fn fixture_output() -> ClientDatum {
  expect [output, _] = adjacent_all_signed_fixture.transaction.outputs
  expect InlineDatum(raw) = output.datum
  expect datum: ClientDatum = raw
  datum
}

test update_and_support_reject_wrong_history_root() fail {
  check_update_client_capacity(
    with_output_datum(
      adjacent_all_signed_fixture,
      ClientDatum {
        ..fixture_output(),
        history_root: ibc_state_commitment.empty_hash,
      },
    ),
  )
}

test update_and_support_reject_changed_processing_time() fail {
  let datum = fixture_output()
  expect [Pair(h, t)] = datum.state.processed_times
  check_update_client_capacity(
    with_output_datum(
      adjacent_all_signed_fixture,
      ClientDatum {
        ..datum,
        state: ClientDatumState {
          ..datum.state,
          processed_times: [Pair(h, t + 1)],
        },
      },
    ),
  )
}

test update_and_support_reject_changed_immutable_parameters() fail {
  let datum = fixture_output()
  check_update_client_capacity(
    with_output_datum(
      adjacent_all_signed_fixture,
      ClientDatum {
        ..datum,
        state: ClientDatumState {
          ..datum.state,
          client_state: ClientState {
            ..datum.state.client_state,
            trusting_period: 1,
          },
        },
      },
    ),
  )
}

test normal_header_cannot_authorize_equal_height_without_freeze() fail {
  expect Some(client) = adjacent_all_signed_fixture.datum
  check_update_client_capacity(
    with_output_datum(adjacent_all_signed_fixture, client),
  )
}

fn check_forged_support(support: RecoverClientWithdrawalRedeemer) -> Bool {
  let fixture = adjacent_all_signed_fixture
  let credential = Script("mock recover client script hash")
  let raw: Redeemer = support
  spending_client.spend_client.spend(
    fixture.host_state_nft_policy_id,
    credential,
    fixture.datum,
    fixture.redeemer,
    fixture.output_reference,
    Transaction {
      ..fixture.transaction,
      withdrawals: [Pair(credential, 0)],
      redeemers: [
        Pair(Withdraw(credential), raw),
        ..fixture.transaction.redeemers
      ],
    },
  )
}

test update_rejects_check_withdrawal_for_another_client() fail {
  expect Some(client) = adjacent_all_signed_fixture.datum
  check_forged_support(
    CheckClientHistory {
      subject_token: AuthToken { ..client.token, name: #"ff" },
    },
  )
}

test update_rejects_recovery_withdrawal_branch() fail {
  expect Some(client) = adjacent_all_signed_fixture.datum
  check_forged_support(
    RecoverClientWithdrawal {
      subject_token: client.token,
      substitute_token: client.token,
    },
  )
}

test support_rejects_another_clients_spend_redeemer() fail {
  let fixture = adjacent_all_signed_fixture
  expect Some(client) = fixture.datum
  let credential = Script("mock recover client script hash")
  recover_client.recover_client.withdraw(
    fixture.host_state_nft_policy_id,
    CheckClientHistory {
      subject_token: AuthToken { ..client.token, name: #"ff" },
    },
    credential,
    fixture.transaction,
  )
}

// Probe the support validator itself: a valid history witness must be evaluated
// even though its hydrated list is used only for an authentication assertion.
fn check_historical_support(tamper_metadata: Bool, tamper_root: Bool) -> Bool {
  let fixture = adjacent_all_signed_fixture
  expect Some(old) = fixture.datum
  let live = fixture_output()
  let input =
    if tamper_root {
      ClientDatum { ..live, history_root: ibc_state_commitment.empty_hash }
    } else {
      live
    }
  let frozen =
    ClientDatum {
      ..input,
      state: ClientDatumState {
        ..input.state,
        client_state: ClientState {
          ..input.state.client_state,
          frozen_height: Height { revision_number: 0, revision_height: 1 },
        },
      },
    }
  let original = consensus_history.from_client(old)
  let record =
    if tamper_metadata {
      consensus_history.ConsensusStateDatum {
        ..original,
        processed_time: original.processed_time + 1,
      }
    } else {
      original
    }
  expect UpdateClient { msg, .. } = fixture.redeemer
  let spend: Redeemer =
    UpdateClient {
      msg,
      history_witnesses: [
        consensus_history.Witness { record, siblings: full_empty_siblings() },
      ],
      history_siblings: [],
    }
  let transaction =
    Transaction {
      ..with_output_datum(fixture, frozen).transaction,
      inputs: list.map(
        fixture.transaction.inputs,
        fn(i) {
          if i.output_reference == fixture.output_reference {
            Input {
              ..i,
              output: Output { ..i.output, datum: InlineDatum(input) },
            }
          } else {
            i
          }
        },
      ),
      redeemers: [
        Pair(Spend(fixture.output_reference), spend),
        ..fixture.transaction.redeemers
      ],
    }
  recover_client.recover_client.withdraw(
    fixture.host_state_nft_policy_id,
    CheckClientHistory { subject_token: old.token },
    Script("mock recover client script hash"),
    transaction,
  )
}

test support_authenticates_history_before_freezing() {
  check_historical_support(False, False)
}

test support_rejects_tampered_historical_processing_metadata() fail {
  check_historical_support(True, False)
}

test support_rejects_history_witness_against_wrong_client_root() fail {
  check_historical_support(False, True)
}
