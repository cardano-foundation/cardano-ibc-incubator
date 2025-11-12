use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_025_handler_interface/handler.{
  HandlerState, empty_ibc_state_root,
}
use ibc/core/ics_025_handler_interface/handler_datum.{
  HandlerDatum, handler_token_name,
}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  CreateClient as HandlerCreateClient,
}
use ibc/utils/string as string_utils
use minting_client

test test_create_valid_client() {
  let mock_client_mint_policy_id =
    #"7b00fe1c61f6fe90bb35ad20ae965a5cbc48d3b88cefbffcafedb64a"
  let mock_latest_height = Height { revision_number: 1, revision_height: 99 }
  let mock_timestamp = 1705635096691000000
  let mock_spend_client_script_hash =
    #"b39a450d76612cb3a690b82cb04c6ab730b83da86937d277ff887722"
  let mock_handler_script_hash =
    #"907e92f65241ea67029c54c535d06805118864f31702a08f58f1699d"
  let mock_handler_auth_token =
    AuthToken {
      policy_id: #"fa413b4f069d5459decaf19a04f64665ad9023b5d3070bf0589c54c8",
      name: handler_token_name,
    }
  let mock_client_sequence = 0
  let mock_spent_output_reference =
    OutputReference {
      transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    }

  //========================arrange input=======================
  let handler_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: mock_client_sequence,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        ibc_state_root: empty_ibc_state_root,
      },
      token: mock_handler_auth_token,
    }

  let handler_input =
    Input {
      output_reference: mock_spent_output_reference,
      output: Output {
        address: from_script(mock_handler_script_hash),
        value: from_asset(
          mock_handler_auth_token.policy_id,
          mock_handler_auth_token.name,
          1,
        ),
        datum: InlineDatum(handler_datum),
        reference_script: None,
      },
    }
  let redeemer: Redeemer = HandlerCreateClient
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [Pair(Spend(mock_spent_output_reference), redeemer)]

  //========================arrange mint=======================
  let client_token_name =
    string_utils.int_to_string(mock_client_sequence)
      |> auth.generate_token_name(mock_handler_auth_token, client_prefix, _)

  let mint = from_asset(mock_client_mint_policy_id, client_token_name, 1)

  //========================arrange output=======================
  let new_client_state =
    client_state.new_client_state(
      chain_id: "cosmoshub",
      trust_level: unchecked_rational.from_int(1),
      trusting_period: 1_000_000_000_000,
      unbonding_period: 1_000_000_000_001,
      max_clock_drift: 1,
      latest_height: mock_latest_height,
      proof_specs: [],
    )

  let new_consensus_state =
    ConsensusState {
      timestamp: mock_timestamp,
      next_validators_hash: #"",
      root: MerkleRoot { hash: #"" },
    }

  let client_token =
    AuthToken { policy_id: mock_client_mint_policy_id, name: client_token_name }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state: new_client_state,
        consensus_states: [Pair(mock_latest_height, new_consensus_state)],
      },
      token: client_token,
    }

  let client_output =
    Output {
      address: from_script(mock_spend_client_script_hash),
      value: from_asset(mock_client_mint_policy_id, client_token_name, 1),
      datum: InlineDatum(client_datum),
      reference_script: None,
    }

  let valid_to =
    ( new_consensus_state.timestamp + new_client_state.trusting_period ) / 1_000_000 - 1

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [handler_input],
      outputs: [client_output],
      mint: mint,
      redeemers: redeemers,
      validity_range: interval.before(valid_to),
    }

  minting_client.mint_client.mint(
    mock_spend_client_script_hash,
    MintClientRedeemer { handler_auth_token: mock_handler_auth_token },
    mock_client_mint_policy_id,
    transaction,
  )
}

test fail_create_valid_client() fail {
  let mock_client_mint_policy_id =
    #"7b00fe1c61f6fe90bb35ad20ae965a5cbc48d3b88cefbffcafedb64a"
  let mock_latest_height = Height { revision_number: 1, revision_height: 99 }
  let mock_timestamp = 1705635096691000000
  let mock_spend_client_script_hash =
    #"b39a450d76612cb3a690b82cb04c6ab730b83da86937d277ff887722"
  let mock_handler_script_hash =
    #"907e92f65241ea67029c54c535d06805118864f31702a08f58f1699d"
  let mock_handler_auth_token =
    AuthToken {
      policy_id: #"fa413b4f069d5459decaf19a04f64665ad9023b5d3070bf0589c54c8",
      name: handler_token_name,
    }
  let mock_client_sequence = 0
  let mock_spent_output_reference =
    OutputReference {
      transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    }

  //========================arrange input=======================
  let handler_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: mock_client_sequence,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
        ibc_state_root: empty_ibc_state_root,
      },
      token: mock_handler_auth_token,
    }

  let handler_input =
    Input {
      output_reference: mock_spent_output_reference,
      output: Output {
        address: from_script(mock_handler_script_hash),
        value: from_asset(
          mock_handler_auth_token.policy_id,
          mock_handler_auth_token.name,
          1,
        ),
        datum: InlineDatum(handler_datum),
        reference_script: None,
      },
    }
  let redeemer: Redeemer = HandlerCreateClient
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [Pair(Spend(mock_spent_output_reference), redeemer)]

  //========================arrange mint=======================
  let client_token_name =
    string_utils.int_to_string(mock_client_sequence)
      |> auth.generate_token_name(mock_handler_auth_token, client_prefix, _)

  let mint = from_asset(mock_client_mint_policy_id, client_token_name, 1)

  //========================arrange output=======================
  let new_client_state =
    client_state.new_client_state(
      chain_id: "cosmoshub",
      trust_level: unchecked_rational.from_int(1),
      trusting_period: 1_000_000_000_000,
      unbonding_period: 1_000_000_000_001,
      max_clock_drift: 1,
      latest_height: mock_latest_height,
      proof_specs: [],
    )

  let new_consensus_state =
    ConsensusState {
      timestamp: mock_timestamp,
      next_validators_hash: #"",
      root: MerkleRoot { hash: #"" },
    }

  let client_output =
    Output {
      address: from_script(mock_spend_client_script_hash),
      value: from_asset(mock_client_mint_policy_id, client_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }

  let valid_to =
    ( new_consensus_state.timestamp + new_client_state.trusting_period ) / 1_000_000 - 1

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [handler_input],
      outputs: [client_output],
      mint: mint,
      redeemers: redeemers,
      validity_range: interval.before(valid_to),
    }

  minting_client.mint_client.mint(
    mock_spend_client_script_hash,
    MintClientRedeemer { handler_auth_token: mock_handler_auth_token },
    mock_client_mint_policy_id,
    transaction,
  )
}
