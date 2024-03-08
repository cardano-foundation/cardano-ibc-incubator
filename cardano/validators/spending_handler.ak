use aiken/dict.{Dict}
use aiken/list
use aiken/transaction.{Mint,
  Redeemer, ScriptContext, ScriptPurpose, Transaction}
use aiken/transaction/value.{PolicyId}
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

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  fn spend_handler(
    datum: HandlerDatum,
    redeemer: HandlerOperator,
    context: ScriptContext,
  ) -> Bool {
    let (spent_output, transaction) =
      validator_utils.extract_spending_context(context)
    let Transaction { outputs, redeemers, .. } = transaction

    //========================valid input=======================
    // input contains handler token
    expect spent_output |> auth.contain_auth_token(datum.token)

    //========================valid output=======================
    expect [updated_output] =
      outputs
        |> list.filter(fn(output) { output.address == spent_output.address })

    // output contains handler token
    expect updated_output |> auth.contain_auth_token(datum.token)

    // output datum is updated correctly
    expect updated_datum: HandlerDatum =
      validator_utils.get_inline_datum(updated_output)
    when redeemer is {
      CreateClient -> {
        expect handler_datum.validate_create_client(datum, updated_datum)
        expect
          validate_create_client(
            redeemers,
            datum.token,
            client_minting_policy_id,
          )?
        True
      }
      HandlerConnOpenInit -> {
        expect handler_datum.validate_create_connection(datum, updated_datum)?
        expect
          validate_conn_open_init(
            redeemers,
            datum.token,
            connection_minting_policy_id,
          )?
        True
      }
      HandlerConnOpenTry -> {
        expect handler_datum.validate_create_connection(datum, updated_datum)?
        expect
          validate_conn_open_try(
            redeemers,
            datum.token,
            connection_minting_policy_id,
          )

        True
      }
      HandlerChanOpenInit -> {
        expect handler_datum.validate_create_channel(datum, updated_datum)?
        expect
          validate_chan_open_init(
            redeemers,
            datum.token,
            channel_minting_policy_id,
          )?
        True
      }
      HandlerChanOpenTry -> {
        expect handler_datum.validate_create_channel(datum, updated_datum)?
        expect
          validate_chan_open_try(
            redeemers,
            datum.token,
            channel_minting_policy_id,
          )
        True
      }
      HandlerBindPort -> {
        expect Some(port_number) =
          validate_bind_port(redeemers, datum.token, port_minting_policy_id)

        expect
          handler_datum.validate_bind_port(datum, updated_datum, port_number)

        True
      }
    }
  }
}

fn validate_create_client(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_auth_token: AuthToken,
  client_minting_policy_id: PolicyId,
) -> Bool {
  // mint client redeemer is MintNewClient operator
  expect Some(mint_client_redeemer) =
    redeemers |> dict.get(Mint(client_minting_policy_id))
  expect mint_client_redeemer: MintClientRedeemer = mint_client_redeemer
  expect mint_client_redeemer == MintClientRedeemer { handler_auth_token }
  True
}

fn validate_conn_open_init(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_auth_token: AuthToken,
  connection_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint connection redeemer for connection open init
  expect Some(mint_connection_redeemer) =
    redeemers |> dict.get(Mint(connection_minting_policy_id))
  expect mint_connection_redeemer: MintConnectionRedeemer =
    mint_connection_redeemer
  expect mint_connection_redeemer == ConnOpenInit { handler_auth_token }
  True
}

fn validate_conn_open_try(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  connection_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint connection redeemer for connection open init
  expect Some(mint_connection_redeemer) =
    redeemers |> dict.get(Mint(connection_minting_policy_id))
  expect mint_connection_redeemer: MintConnectionRedeemer =
    mint_connection_redeemer
  expect ConnOpenTry { handler_auth_token: conn_handler_token, .. } =
    mint_connection_redeemer

  expect handler_token == conn_handler_token

  True
}

fn validate_chan_open_init(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  channel_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint channel redeemer for channel open init
  expect Some(mint_channel_redeemer) =
    redeemers |> dict.get(Mint(channel_minting_policy_id))

  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer

  expect mint_channel_redeemer == ChanOpenInit { handler_token }

  True
}

fn validate_chan_open_try(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  channel_minting_policy_id: PolicyId,
) -> Bool {
  // valid mint channel redeemer for channel open try
  expect Some(mint_channel_redeemer) =
    redeemers |> dict.get(Mint(channel_minting_policy_id))

  expect mint_channel_redeemer: MintChannelRedeemer = mint_channel_redeemer

  expect ChanOpenTry { handler_token: chan_handler_token, .. } =
    mint_channel_redeemer
  expect chan_handler_token == handler_token

  True
}

fn validate_bind_port(
  redeemers: Dict<ScriptPurpose, Redeemer>,
  handler_token: AuthToken,
  port_minting_policy_id: PolicyId,
) -> Option<Int> {
  // valid mint port redeemer for bind port
  expect Some(mint_port_redeemer) =
    redeemers |> dict.get(Mint(port_minting_policy_id))

  expect mint_port_redeemer: MintPortRedeemer = mint_port_redeemer

  let MintPortRedeemer { handler_token: port_handler_token, port_number, .. } =
    mint_port_redeemer

  expect port_handler_token == handler_token

  Some(port_number)
}
