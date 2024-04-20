use aiken/dict
use aiken/list
use aiken/transaction.{Output, ScriptContext, Transaction}
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/types/version as version_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanOpenAck}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanOpenAck}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  fn chan_open_ack(channel_token: AuthToken, context: ScriptContext) -> Bool {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = context.transaction

    expect Some((datum, channel_redeemer, spent_output)) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect auth.contain_auth_token(spent_output, datum.token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    expect auth.contain_auth_token(updated_output, datum.token)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect [connection_id] = datum.state.channel.connection_hops

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect ChanOpenAck { counterparty_version, proof_try, proof_height } =
      channel_redeemer

    trace @"chan_open_ack: tx context extracted"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"chan_open_ack: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"chan_open_ack: Connection is open"

    expect [connection_version] = connection_datum.state.versions
    expect
      chan_order_mod.string(datum.state.channel.ordering)
        |> version_mod.verify_supported_feature(connection_version, _)
    trace @"chan_open_ack: connection support channel ordering"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"chan_open_ack: validator_utils.validate_referred_client"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        dict.from_list(client_datum.state.consensus_states, height_mod.compare),
      ) == client_status_mod.Active
    trace @"chan_open_ack: client status is active"

    expect channel_datum_mod.is_channel_open_ack_valid(datum, updated_datum)
    trace @"chan_open_ack: output datum is updated valid"

    expect
      validate_chan_open_ack_proof(
        connection_datum.state,
        client_datum.state,
        channel_id,
        updated_datum,
        counterparty_version,
        proof_try,
        proof_height,
      )
    trace @"chan_open_ack: channel proof is valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        datum.port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect ibc_module_callback == OnChanOpenAck { channel_id }
    trace @"chan_open_ack: ibc module callback is valid"

    True
  }
}

fn validate_chan_open_ack_proof(
  connection_end: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  counterparty_version: ByteArray,
  proof_try: MerkleProof,
  proof_height: Height,
) -> Bool {
  let counterparty_hops =
    [connection_end.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: chan_state_mod.TryOpen,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: counterparty_version,
    }

  verify_mod.verify_channel_state(
    client_datum_state,
    connection_end,
    channel_datum.state.channel.counterparty.port_id,
    channel_datum.state.channel.counterparty.channel_id,
    proof_try,
    proof_height,
    expected_channel,
  )
}
