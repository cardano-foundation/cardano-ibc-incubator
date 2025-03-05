use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Output, OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanCloseInit}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanCloseInit}
use ibc/utils/validator_utils

validator chan_close_init(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    channel_token: AuthToken,
    _spent_output: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = transaction

    let (datum, channel_redeemer, spent_output) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect ChanCloseInit == channel_redeemer

    trace @"chan_close_init: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState { channel: cur_channel, .. } = cur_channel_state

    expect [connection_id] = cur_channel.connection_hops

    expect cur_channel.state != chan_state_mod.Closed
    trace @"chan_close_init: channel state is not Closed"

    let connection_datum =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"chan_close_init: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"chan_close_init: Connection is open"

    let client_datum =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"chan_close_init: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"chan_close_init: client status is active"

    let ibc_module_redeemer =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect ibc_module_callback == OnChanCloseInit { channel_id }
    trace @"chan_close_init: ibc module callback is valid"

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      channel_datum_mod.validate_chan_close_init(datum, updated_datum),
    }
  }

  else(_) {
    fail
  }
}
