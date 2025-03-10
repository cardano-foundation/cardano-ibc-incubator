use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{
  Mint, Output, OutputReference, Redeemer, ScriptPurpose, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanCloseConfirm}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanOpenConfirm}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/utils/validator_utils

validator chan_close_confirm(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    channel_token: AuthToken,
    _spent_output_ref: OutputReference,
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

    expect Some((datum, channel_redeemer, spent_output)) =
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

    expect ChanCloseConfirm { proof_init, proof_height } = channel_redeemer

    trace @"chan_close_confirm: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState { channel: cur_channel, .. } = cur_channel_state

    expect [connection_id] = cur_channel.connection_hops

    expect cur_channel.state != chan_state_mod.Closed
    trace @"chan_close_confirm: channel state is not Closed"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"chan_close_confirm: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"chan_close_confirm: Connection is open"

    let client_datum =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"chan_close_confirm: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"chan_close_confirm: client status is active"

    let valid_chan_close =
      validate_chan_close_confirm_proof(
        connection_datum.state,
        client_datum.state,
        channel_id,
        updated_datum,
        proof_init,
        proof_height,
        redeemers,
        verify_proof_policy_id,
      )
    trace @"chan_close_confirm: channel proof is valid"

    let ibc_module_redeemer =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect ibc_module_callback == OnChanOpenConfirm { channel_id }
    trace @"chan_close_confirm: ibc module callback is valid"

    and {
      channel_token == datum.token,
      auth.contain_auth_token(updated_output, datum.token),
      channel_datum_mod.validate_chan_close_confirm(datum, updated_datum),
      valid_chan_close,
    }
  }

  else(_) {
    fail
  }
}

fn validate_chan_close_confirm_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  proof: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let counterparty_hops = [connection.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: chan_state_mod.Closed,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: channel_datum.state.channel.version,
    }

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          channel_keys.channel_path(
            channel_datum.state.channel.counterparty.port_id,
            channel_datum.state.channel.counterparty.channel_id,
          ),
        ],
      ),
    )

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let channel_bz =
    channel_pb.marshal_for_channel(
      Some(channel.convert_to_channel_proto(expected_channel)),
    )

  verify_proof_redeemer == VerifyMembership {
    cs: client_datum_state.client_state,
    cons_state: consensus_state,
    height: proof_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path: merkle_path,
    value: channel_bz,
  }
}
