use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, Redeemer, ScriptPurpose, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd} as connection_end_mod
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenInit, ChanOpenTry, MintChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnChanOpenInit, OnChanOpenTry,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/channel_keys as host_chan_keys
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerChanOpenInit, HandlerChanOpenTry,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_channel(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
) {
  mint(
    redeemer: MintChannelRedeemer,
    channel_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
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
        trace @"mint_channel: ChanOpenInit branch"

        let handler_datum =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_token,
            HandlerChanOpenInit,
          )
        trace @"mint_channel: spent handler redeemer is valid"

        let connection_datum =
          validator_utils.validate_referred_connection(
            reference_inputs,
            channel_output_datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_connection"

        expect [connection_version] = connection_datum.state.versions
        let valid_feature =
          order.string(channel_output_datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"mint_channel: validate connection support channel ordering"

        let client_datum =
          validator_utils.validate_referred_client(
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_client"

        let is_status_active =
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_channel: client status is active"

        let channel_token =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> validator_utils.validate_mint(
                mint,
                channel_minting_policy_id,
                handler_token,
                channel_keys.channel_prefix,
                _,
              )
        trace @"mint_channel: validator_utils.validate_mint"

        let is_channel_open =
          channel_datum.validate_chan_open_init(
            channel_output_datum,
            channel_token,
          )
        trace @"mint_channel: channel datum is initialized valid"

        let channel_id =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> channel_keys.format_channel_identifier()

        let ibc_module_redeemer =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            channel_token.name,
            port_minting_policy_id,
            channel_output_datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        and {
          valid_feature?,
          is_status_active?,
          is_channel_open?,
          auth.contains_only_auth_tokens(channel_output, [channel_token])?,
          (ibc_module_callback == OnChanOpenInit { channel_id })?,
        }
      }

      ChanOpenTry {
        handler_token,
        counterparty_version,
        proof_init,
        proof_height,
      } -> {
        trace @"mint_channel: ChanOpenTry branch"

        let handler_datum =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_token,
            HandlerChanOpenTry,
          )
        trace @"mint_channel: spent handler redeemer is HandlerChanOpenTry"

        let connection_datum =
          validator_utils.validate_referred_connection(
            reference_inputs,
            channel_output_datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"mint_channel: reference_inputs contain Connection utxo"

        expect [connection_version] = connection_datum.state.versions
        expect
          order.string(channel_output_datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"mint_channel: connection support channel ordering"

        let client_datum =
          validator_utils.validate_referred_client(
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_client"

        let is_channel_active =
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_channel: client status is active"

        let channel_token =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> validator_utils.validate_mint(
                mint,
                channel_minting_policy_id,
                handler_token,
                channel_keys.channel_prefix,
                _,
              )
        trace @"mint_channel: validator_utils.validate_mint"

        let is_channel_open =
          channel_datum.validate_chan_open_try(
            channel_output_datum,
            channel_token,
          )
        trace @"mint_channel: channel datum is initialized valid"

        let valid_channel =
          validate_chan_open_try_proof(
            connection_datum.state,
            client_datum.state,
            channel_output_datum,
            counterparty_version,
            proof_init,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )
        trace @"mint_channel: channel init proof is valid"

        let channel_id =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> channel_keys.format_channel_identifier()

        let ibc_module_redeemer =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            channel_token.name,
            port_minting_policy_id,
            channel_output_datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        and {
          (connection_datum.state.state == connection_state.Open)?,
          is_channel_active?,
          auth.contains_only_auth_tokens(channel_output, [channel_token])?,
          is_channel_open?,
          valid_channel?,
          (ibc_module_callback == OnChanOpenTry { channel_id })?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_chan_open_try_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_datum: ChannelDatum,
  counterparty_version: ByteArray,
  proof: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let counterparty_hops = [connection.counterparty.connection_id]

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

  let time_delay = connection.delay_period
  let block_delay = verify.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          host_chan_keys.channel_path(
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
      channel.convert_to_channel_proto(expected_channel),
    ).2nd

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

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
