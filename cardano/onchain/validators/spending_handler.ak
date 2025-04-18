use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Mint, OutputReference, Redeemer, ScriptPurpose, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  ConnOpenInit, ConnOpenTry, MintConnectionRedeemer,
}
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenInit, ChanOpenTry, MintChannelRedeemer,
}
use ibc/core/ics_005/port_redeemer.{MintPortRedeemer}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  CreateClient, HandlerBindPort, HandlerChanOpenInit, HandlerChanOpenTry,
  HandlerConnOpenInit, HandlerConnOpenTry, HandlerOperator,
}
use ibc/utils/validator_utils

validator spend_handler(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  spend(
    datum: Option<HandlerDatum>,
    redeemer: HandlerOperator,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, redeemers, .. } = transaction

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    //========================valid input=======================
    // input contains handler token
    expect Some(datum) = datum
    expect spent_output |> auth.contain_auth_token(datum.token)

    //========================valid output=======================
    expect [updated_output] =
      outputs
        |> list.filter(fn(output) { output.address == spent_output.address })

    // output contains handler token
    // output datum is updated correctly
    expect updated_datum: HandlerDatum =
      validator_utils.get_inline_datum(updated_output)
    let valid_redeemer =
      when redeemer is {
        CreateClient -> and {
            handler_datum.validate_create_client(datum, updated_datum),
            validate_create_client(
              redeemers,
              datum.token,
              client_minting_policy_id,
            )?,
          }
        HandlerConnOpenInit -> and {
            handler_datum.validate_create_connection(datum, updated_datum)?,
            validate_conn_open_init(
              redeemers,
              datum.token,
              connection_minting_policy_id,
            )?,
          }
        HandlerConnOpenTry -> and {
            handler_datum.validate_create_connection(datum, updated_datum)?,
            validate_conn_open_try(
              redeemers,
              datum.token,
              connection_minting_policy_id,
            ),
          }

        HandlerChanOpenInit -> and {
            handler_datum.validate_create_channel(datum, updated_datum)?,
            validate_chan_open_init(
              redeemers,
              datum.token,
              channel_minting_policy_id,
            )?,
          }
        HandlerChanOpenTry -> and {
            handler_datum.validate_create_channel(datum, updated_datum)?,
            validate_chan_open_try(
              redeemers,
              datum.token,
              channel_minting_policy_id,
            ),
          }
        HandlerBindPort -> {
          let port_number =
            validate_bind_port(redeemers, datum.token, port_minting_policy_id)

          handler_datum.validate_bind_port(datum, updated_datum, port_number)
        }
      }
    and {
      valid_redeemer,
      updated_output |> auth.contain_auth_token(datum.token),
    }
  }

  else(_) {
    fail
  }
}

fn validate_create_client(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  handler_auth_token: AuthToken,
  client_minting_policy_id: PolicyId,
) -> Bool {
  // mint client redeemer is MintNewClient operator
  expect Some(mint_client_redeemer) =
    pairs.get_first(redeemers, Mint(client_minting_policy_id))
  expect mint_client_redeemer: MintClientRedeemer = mint_client_redeemer
  mint_client_redeemer == MintClientRedeemer { handler_auth_token }
}

fn validate_conn_open_init(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  handler_auth_token: AuthToken,
  connection_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint connection redeemer for connection open init
  expect Some(mint_connection_redeemer) =
    pairs.get_first(redeemers, Mint(connection_minting_policy_id))
  expect mint_connection_redeemer: MintConnectionRedeemer =
    mint_connection_redeemer
  mint_connection_redeemer == ConnOpenInit { handler_auth_token }
}

fn validate_conn_open_try(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  connection_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint connection redeemer for connection open init
  expect Some(mint_connection_redeemer) =
    pairs.get_first(redeemers, Mint(connection_minting_policy_id))
  expect mint_connection_redeemer: MintConnectionRedeemer =
    mint_connection_redeemer
  expect ConnOpenTry { handler_auth_token: conn_handler_token, .. } =
    mint_connection_redeemer

  handler_token == conn_handler_token
}

fn validate_chan_open_init(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  channel_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint channel redeemer for channel open init
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))

  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer

  mint_channel_redeemer == ChanOpenInit { handler_token }
}

fn validate_chan_open_try(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  channel_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint channel redeemer for channel open try
  expect Some(mint_channel_redeemer) =
    pairs.get_first(redeemers, Mint(channel_minting_policy_id))

  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer

  expect ChanOpenTry { handler_token: chan_handler_token, .. } =
    mint_channel_redeemer
  chan_handler_token == handler_token
}

fn validate_bind_port(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  port_minting_policy_id: PolicyId,
) -> Int {
  // valid mint port redeemer for bind port
  expect Some(mint_port_redeemer) =
    pairs.get_first(redeemers, Mint(port_minting_policy_id))

  expect mint_port_redeemer: MintPortRedeemer = mint_port_redeemer

  let MintPortRedeemer { handler_token: port_handler_token, port_number, .. } =
    mint_port_redeemer

  expect port_handler_token == handler_token

  port_number
}
