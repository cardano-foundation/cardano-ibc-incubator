use aiken/dict.{Dict}
use aiken/hash.{Blake2b_224, Hash}
use aiken/interval
use aiken/list
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId,
}
use aiken/transaction/credential.{Script}
use aiken/transaction/value
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{
  HandlerDatum, handler_token_name,
}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  CreateClient as HandlerCreateClient, HandlerOperator,
}
use ibc/utils/validator_utils

validator(spend_client_script_hash: Hash<Blake2b_224, Script>) {
  fn mint_client(redeemer: MintClientRedeemer, context: ScriptContext) -> Bool {
    let ScriptContext { transaction, purpose } = context
    expect Mint(client_mint_policy_id) = purpose
    let Transaction { inputs, outputs, mint, redeemers, validity_range, .. } =
      transaction
    let handler_auth_token = redeemer.handler_auth_token

    //========================valid input=======================
    // input contains handler auth token
    expect Some(handler_input) =
      inputs
        |> list.find(
             fn(input) {
               input.output |> auth.contain_auth_token(handler_auth_token)
             },
           )

    // spent handler redeemer is CreateClient operator
    expect Some(spent_handler_redeemer) =
      redeemers |> dict.get(Spend(handler_input.output_reference))
    expect handler_operator: HandlerOperator = spent_handler_redeemer
    expect handler_operator == HandlerCreateClient

    //========================valid mint=======================
    // extract client id
    let spent_handler_output = handler_input.output
    expect spent_handler_datum: HandlerDatum =
      validator_utils.get_inline_datum(spent_handler_output)

    // mint just 1 client_state token
    let client_token_name =
      auth.generate_token_name(
        handler_auth_token,
        client_prefix,
        spent_handler_datum.state.next_client_sequence,
      )
    let client_token =
      AuthToken { policy_id: client_mint_policy_id, name: client_token_name }
    expect mint |> auth.mint_auth_token(client_token)

    //========================valid output========================
    expect [client_output] =
      outputs
        |> transaction.find_script_outputs(spend_client_script_hash)

    // client utxo contains auth token
    expect client_output |> auth.contain_auth_token(client_token)

    // client utxo datum created valid
    expect client_output_datum: ClientDatum =
      validator_utils.get_inline_datum(client_output)
    expect
      client_output_datum
        |> client_datum.is_initialized_valid(client_token)

    // client status must be Active
    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    expect
      client_state.status(
        client_output_datum.state.client_state,
        // posix time in cardano is millisecond while time of cosmos tendermint is nanosecond
        tx_valid_to * 1_000_000,
        dict.from_list(
          client_output_datum.state.consensus_states,
          height.compare,
        ),
      ) == Active

    True
  }
}

//==========================test==========================
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
  let mock_client_id = 0
  let mock_spent_output_reference =
    OutputReference {
      transaction_id: TransactionId { hash: "tx_hash" },
      output_index: 0,
    }

  //========================arrange input=======================
  let handler_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: mock_client_id,
        next_connection_sequence: 0,
        next_channel_sequence: 0,
        bound_port: [],
      },
      token: mock_handler_auth_token,
    }

  let handler_input =
    Input {
      output_reference: mock_spent_output_reference,
      output: Output {
        address: credential.from_script(mock_handler_script_hash),
        value: value.from_asset(
          mock_handler_auth_token.policy_id,
          mock_handler_auth_token.name,
          1,
        ),
        datum: InlineDatum(handler_datum),
        reference_script: None,
      },
    }
  let redeemer: Data = HandlerCreateClient
  let redeemers: Dict<ScriptPurpose, Redeemer> =
    [(Spend(mock_spent_output_reference), redeemer)]
      |> dict.from_list(fn(_key1, _key2) { Greater })

  //========================arrange mint=======================
  let client_token_name =
    auth.generate_token_name(
      mock_handler_auth_token,
      client_prefix,
      mock_client_id,
    )

  let mint =
    value.from_asset(mock_client_mint_policy_id, client_token_name, 1)
      |> value.to_minted_value()

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
        consensus_states: dict.new()
          |> dict.insert(mock_latest_height, new_consensus_state, height.compare)
          |> dict.to_list(),
      },
      token: client_token,
    }

  let client_output =
    Output {
      address: credential.from_script(mock_spend_client_script_hash),
      value: value.from_asset(mock_client_mint_policy_id, client_token_name, 1),
      datum: InlineDatum(client_datum),
      reference_script: None,
    }

  let valid_to =
    ( new_consensus_state.timestamp + new_client_state.trusting_period ) / 1_000_000 - 1

  let context =
    ScriptContext {
      purpose: Mint(mock_client_mint_policy_id),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: [handler_input],
        outputs: [client_output],
        mint: mint,
        redeemers: redeemers,
        validity_range: interval.before(valid_to),
      },
    }

  mint_client(
    mock_spend_client_script_hash,
    MintClientRedeemer { handler_auth_token: mock_handler_auth_token },
    context,
  )
}
