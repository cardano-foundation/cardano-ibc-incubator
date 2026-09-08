use aiken/cbor
use aiken/interval
use cardano/address.{Script, from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
} as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
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
use spending_client

type MockData {
  host_state_nft_policy_id: PolicyId,
  host_state_input: Input,
  host_state_output: Output,
  client_token: AuthToken,
  output_reference: OutputReference,
  input: Input,
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

fn processed_time_for_update(header: Header, client_state: ClientState) -> Int {
  (
    ( header.signed_header.header.time - client_state.max_clock_drift ) / 1_000_000 + 1000
  ) * 1_000_000
}

fn update_client_output_datum(
  client_datum: ClientDatum,
  output: Output,
) -> Output {
  Output { ..output, datum: InlineDatum(client_datum) }
}

fn check_update_client_capacity(
  encoded_redeemer: ByteArray,
  trusted_timestamp: Int,
  trusted_app_hash: ByteArray,
  trusted_validator_set_hash: ByteArray,
) -> Bool {
  let mock = setup()
  expect Some(data) = cbor.deserialise(encoded_redeemer)
  expect redeemer: SpendClientRedeemer = data
  expect UpdateClient{msg: HeaderCase(header)} = redeemer

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
  let processed_time = processed_time_for_update(header, client_state)
  let updated_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        client_state: ClientState {
          ..client_state,
          latest_height: header_height,
        },
        consensus_states: [
          Pair(header_height, header_mod.consensus_state(header)),
          Pair(header.trusted_height, consensus_state),
        ],
        processed_times: [
          Pair(header_height, processed_time),
          Pair(header.trusted_height, 0),
        ],
        processed_heights: [
          Pair(
            header_height,
            client_datum_mod.processed_height_from_time(processed_time),
          ),
          Pair(header.trusted_height, 0),
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
      removed_consensus_state_siblings: [],
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

  spending_client.spend_client.spend(
    mock.host_state_nft_policy_id,
    Script("mock recover client script hash"),
    Some(client_datum),
    redeemer,
    mock.output_reference,
    transaction,
  )
}

test update_client_capacity_adjacent_all_signed_45_succeeds() {
  check_update_client_capacity(
    adjacent_all_signed_spend_client_redeemer_cbor,
    adjacent_all_signed_trusted_timestamp,
    adjacent_all_signed_trusted_app_hash,
    adjacent_all_signed_trusted_validator_set_hash,
  )
}

test update_client_capacity_adjacent_mixed_45_succeeds() {
  check_update_client_capacity(
    adjacent_mixed_spend_client_redeemer_cbor,
    adjacent_mixed_trusted_timestamp,
    adjacent_mixed_trusted_app_hash,
    adjacent_mixed_trusted_validator_set_hash,
  )
}

test update_client_capacity_non_adjacent_mixed_45_succeeds() {
  check_update_client_capacity(
    non_adjacent_mixed_spend_client_redeemer_cbor,
    non_adjacent_mixed_trusted_timestamp,
    non_adjacent_mixed_trusted_app_hash,
    non_adjacent_mixed_trusted_validator_set_hash,
  )
}
