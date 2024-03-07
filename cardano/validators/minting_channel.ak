use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction.{Mint, ScriptContext, Transaction}
use aiken/transaction/credential.{Script}
use aiken/transaction/value.{PolicyId}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenInit, ChanOpenTry, MintChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/ibc_module_redeemer.{OnChanOpenInit, OnChanOpenTry}
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerChanOpenInit, HandlerChanOpenTry,
}
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
) {
  fn mint_channel(redeemer: MintChannelRedeemer, context: ScriptContext) -> Bool {
    let ScriptContext { transaction, purpose } = context
    expect Mint(channel_minting_policy_id) = purpose
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      mint,
      validity_range,
      redeemers,
      ..
    } = transaction

    expect [channel_output] =
      outputs
        |> transaction.find_script_outputs(spend_channel_script_hash)
    expect channel_output_datum: ChannelDatum =
      validator_utils.get_inline_datum(channel_output)
    trace @"mint_channel: found channel output"

    expect [connection_id] = channel_output_datum.state.channel.connection_hops
    trace @"mint_channel: extract connection_id"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"mint_channel: validator_utils.get_tx_valid_to"

    when redeemer is {
      ChanOpenInit { handler_token } -> {
        trace @"mint_channel: ChanOpenInit branch\n"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_token,
            HandlerChanOpenInit,
          )
        trace @"mint_channel: spent handler redeemer is valid\n"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            channel_output_datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_connection\n"

        expect [connection_version] = connection_datum.state.versions
        expect
          order.string(channel_output_datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"mint_channel: validate connection support channel ordering\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_channel: client status is active\n"

        expect Some(channel_token) =
          validator_utils.validate_mint(
            mint,
            channel_minting_policy_id,
            handler_token,
            channel_keys.channel_prefix,
            handler_datum.state.next_channel_sequence,
          )
        trace @"mint_channel: validator_utils.validate_mint\n"

        expect auth.contain_auth_token(channel_output, channel_token)
        trace @"mint_channel: output contains connection token"

        expect
          channel_datum.is_chan_open_init_valid(
            channel_output_datum,
            channel_token,
          )
        trace @"mint_channel: channel datum is initialized valid\n"

        let channel_id =
          channel_keys.format_channel_identifier(
            handler_datum.state.next_channel_sequence,
          )

        expect Some(ibc_module_callback) =
          validator_utils.validate_module_callback(
            inputs,
            redeemers,
            channel_token.name,
            port_minting_policy_id,
            channel_output_datum.port_id,
          )
        expect ibc_module_callback == OnChanOpenInit { channel_id }
        trace @"mint_channel: ibc module callback is valid\n"

        True
      }

      ChanOpenTry {
        handler_token,
        counterparty_version,
        proof_init,
        proof_height,
      } -> {
        trace @"mint_channel: ChanOpenTry branch\n"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_token,
            HandlerChanOpenTry,
          )
        trace @"mint_channel: spent handler redeemer is HandlerChanOpenTry\n"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            channel_output_datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"mint_channel: reference_inputs contain Connection utxo\n"

        expect connection_datum.state.state == connection_state.Open
        trace @"mint_channel: Connection is open\n"

        expect [connection_version] = connection_datum.state.versions
        expect
          order.string(channel_output_datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"mint_channel: connection support channel ordering\n"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_client\n"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_channel: client status is active\n"

        expect Some(channel_token) =
          validator_utils.validate_mint(
            mint,
            channel_minting_policy_id,
            handler_token,
            channel_keys.channel_prefix,
            handler_datum.state.next_channel_sequence,
          )
        trace @"mint_channel: validator_utils.validate_mint\n"

        expect auth.contain_auth_token(channel_output, channel_token)
        trace @"mint_channel: output contains connection token"

        expect
          channel_datum.is_chan_open_try_valid(
            channel_output_datum,
            channel_token,
          )
        trace @"mint_channel: channel datum is initialized valid\n"

        expect
          validate_chan_open_try_proof(
            connection_datum.state,
            client_datum.state,
            channel_output_datum,
            counterparty_version,
            proof_init,
            proof_height,
          )
        trace @"mint_channel: channel init proof is valid\n"

        let channel_id =
          channel_keys.format_channel_identifier(
            handler_datum.state.next_channel_sequence,
          )

        expect Some(ibc_module_callback) =
          validator_utils.validate_module_callback(
            inputs,
            redeemers,
             channel_token.name,
            port_minting_policy_id,
            channel_output_datum.port_id,
          )
        expect ibc_module_callback == OnChanOpenTry { channel_id }
        trace @"mint_channel: ibc module callback is valid\n"

        True
      }
    }
  }
}

fn validate_chan_open_try_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_datum: ChannelDatum,
  counterparty_version: ByteArray,
  proof_init: ByteArray,
  proof_height: Height,
) -> Bool {
  let counterparty_hops =
    [connection_end.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id: "" }

  let expected_channel =
    Channel {
      state: channel_state.Init,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: counterparty_version,
    }

  verify.verify_channel_state(
    client_datum_state,
    connection_end,
    channel_datum.state.channel.counterparty.port_id,
    channel_datum.state.channel.counterparty.channel_id,
    proof_init,
    proof_height,
    expected_channel,
  )
}
