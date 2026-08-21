// IBC Channel Minting Validator - STT Architecture

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script, VerificationKeyHash}
use cardano/address
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Mint, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd} as connection_end_mod
use ibc/core/ics_003_connection_semantics/types/keys as connection_keys
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, validate_chan_open_init, validate_chan_open_try,
}
use ibc/core/ics_004/channel_redeemer.{
  BurnChannel, ChanOpenInit, ChanOpenTry, MintChannelRedeemer, ReclaimChannel,
  SpendChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
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
      assets.has_nft(input.output.value, nft_policy, host_state_token_name)
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
  when host_redeemer is {
    CreateChannel { .. } -> True
    _ -> False
  }
}

fn spent_connection_and_referred_client(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  channel_token_name: ByteArray,
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  connection_id: ByteArray,
) -> (ConnectionDatum, ClientDatum) {
  let connection_sequence =
    connection_keys.parse_connection_id_sequence(connection_id)
  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: auth.generate_token_name_from_another(
        channel_token_name,
        connection_keys.connection_prefix,
        connection_sequence,
      ),
    }
  expect [connection_input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, connection_token) },
    )
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(connection_input.output)

  let client_datum =
    validator_utils.validate_referred_client(
      reference_inputs,
      channel_token_name,
      client_minting_policy_id,
      connection_datum.state.client_id,
    )

  (connection_datum, client_datum)
}

fn validate_channel_burn(
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  token: AuthToken,
  reclaim_to: VerificationKeyHash,
  transaction: Transaction,
) -> Bool {
  let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
  expect token.policy_id == channel_minting_policy_id
  expect [channel_input] =
    list.filter(
      inputs,
      fn(input) {
        input.output.address.payment_credential == address.Script(
          spend_channel_script_hash,
        ) && auth.contain_auth_token(input.output, token)
      },
    )
  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_input.output)
  expect channel_datum.token == token
  expect Some(channel_spend_redeemer) =
    pairs.get_first(redeemers, Spend(channel_input.output_reference))
  expect ReclaimChannel { reclaim_to: spend_reclaim_to }: SpendChannelRedeemer =
    channel_spend_redeemer
  expect _ =
    validator_utils.require_host_state_redeemer(
      inputs,
      outputs,
      redeemers,
      host_state_nft_policy_id,
      validator_utils.ExpectReclaimChannel { reclaim_to },
    )

  and {
    spend_reclaim_to == reclaim_to,
    auth.burn_auth_token(mint, token),
    validator_utils.no_output_contains_auth_token(outputs, token),
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
    when redeemer is {
      BurnChannel { token, reclaim_to } ->
        validate_channel_burn(
          spend_channel_script_hash,
          host_state_nft_policy_id,
          channel_minting_policy_id,
          token,
          reclaim_to,
          transaction,
        )
      _ -> {
        let Transaction {
          inputs,
          reference_inputs,
          outputs,
          mint,
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

        expect [connection_id] =
          channel_output_datum.state.channel.connection_hops

        let (connection_datum, client_datum) =
          spent_connection_and_referred_client(
            inputs,
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_minting_policy_id,
            connection_id,
          )

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

        let channel_id =
          string_utils.int_to_string(channel_id_sequence)
            |> channel_keys.format_channel_identifier()

        let ibc_module_redeemer =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            port_minting_policy_id,
            channel_output_datum.port_id,
            host_state_nft_policy_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer

        let valid_channel =
          when redeemer is {
            ChanOpenInit -> and {
                validate_chan_open_init(channel_output_datum, channel_token)?,
                (ibc_module_callback == OnChanOpenInit { channel_id })?,
              }
            ChanOpenTry { counterparty_version, proof_init, proof_height } ->
              and {
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
            BurnChannel { .. } -> False
          }

        and {
          auth.mint_auth_token(mint, channel_token)?,
          valid_channel?,
          spent_host_state_for_create_channel(redeemers, host_state_input)?,
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
  expect Some(processed_time) =
    pairs.get_first(client_datum_state.processed_times, proof_height)
  expect Some(processed_height) =
    pairs.get_first(client_datum_state.processed_heights, proof_height)

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
    processed_time,
    processed_height,
    delay_time_period: time_delay,
    delay_block_period: block_delay,
    proof,
    path: merkle_path,
    value: channel_bz,
  }
}
