// IBC Channel Minting Validator - STT Architecture

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Mint, Redeemer, ScriptPurpose, Spend, Transaction,
}
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
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, validate_chan_open_init, validate_chan_open_try,
}
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
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateChannel, HostStateRedeemer,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      let quantity =
        quantity_of(input.output.value, nft_policy, host_state_token_name)
      quantity == 1
    },
  )
}

fn spent_host_state_for_create_channel(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_state_input: Input,
) -> Bool {
  expect Some(spend_redeemer) =
    pairs.get_first(redeemers, Spend(host_state_input.output_reference))
  expect host_redeemer: HostStateRedeemer = spend_redeemer

  // Channel token minting is paired with the HostState transition that consumes
  // next_channel_sequence and commits the channel/sequence paths.
  when host_redeemer is {
    CreateChannel { .. } -> True
    _ -> False
  }
}

validator mint_channel_stt(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
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

    expect Some(host_state_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)

    expect InlineDatum(datum) = host_state_input.output.datum
    expect host_state_datum: HostStateDatum = datum
    let channel_id_sequence = host_state_datum.state.next_channel_sequence

    expect [channel_output] =
      transaction.find_script_outputs(outputs, spend_channel_script_hash)
    expect channel_output_datum: ChannelDatum =
      validator_utils.get_inline_datum(channel_output)

    expect [connection_id] = channel_output_datum.state.channel.connection_hops

    let connection_datum =
      validator_utils.validate_referred_connection(
        reference_inputs,
        channel_output_datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )

    let client_datum =
      validator_utils.validate_referred_client(
        reference_inputs,
        channel_output_datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    let client_state_active =
      client_state.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == Active

    let id_str = string_utils.int_to_string(channel_id_sequence)
    let host_state_nft =
      AuthToken {
        policy_id: host_state_nft_policy_id,
        name: host_state_token_name,
      }
    let channel_token_name =
      auth.generate_token_name(
        host_state_nft,
        channel_keys.channel_prefix,
        id_str,
      )
    let channel_token =
      AuthToken {
        policy_id: channel_minting_policy_id,
        name: channel_token_name,
      }

    expect [connection_version] = connection_datum.state.versions
    let valid_feature =
      order.string(channel_output_datum.state.channel.ordering)
        |> version.verify_supported_feature(connection_version, _)

    let channel_id =
      string_utils.int_to_string(channel_id_sequence)
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

    let valid_channel =
      when redeemer is {
        ChanOpenInit -> and {
            validate_chan_open_init(channel_output_datum, channel_token)?,
            (ibc_module_callback == OnChanOpenInit { channel_id })?,
          }
        ChanOpenTry { counterparty_version, proof_init, proof_height } -> and {
            (connection_datum.state.state == connection_state.Open)?,
            validate_chan_open_try(channel_output_datum, channel_token)?,
            validate_chan_open_try_proof(
              connection_datum.state,
              client_datum.state,
              channel_output_datum,
              counterparty_version,
              proof_init,
              proof_height,
              redeemers,
              verify_proof_policy_id,
            )?,
            (ibc_module_callback == OnChanOpenTry { channel_id })?,
          }
      }

    and {
      valid_feature?,
      client_state_active?,
      auth.mint_auth_token(mint, channel_token)?,
      auth.contains_only_auth_tokens(channel_output, [channel_token])?,
      valid_channel?,
      spent_host_state_for_create_channel(redeemers, host_state_input)?,
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
