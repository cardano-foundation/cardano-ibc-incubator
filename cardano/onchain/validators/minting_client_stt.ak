// IBC Client Minting Validator - STT Architecture

use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/primitive/bytearray
use cardano/address
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  ArchiveConsensusState, MintClient, MintClientRedeemer, PruneConsensusState,
  RecoverClient, SpendClientRedeemer, UpdateClient,
}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/consensus_history.{ConsensusStateDatum}
use ibc/client/ics_007_tendermint_client/height
use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_024_host_requirements/client_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateClient, HostStateRedeemer,
} as host_redeemer
use ibc/core/ics_025_handler_interface/ibc_state_commitment
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

fn spent_host_state_for_create_client(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  host_state_input: Input,
) -> Bool {
  expect Some(spend_redeemer) =
    pairs.get_first(redeemers, Spend(host_state_input.output_reference))
  expect host_redeemer: HostStateRedeemer = spend_redeemer

  // The mint is authorized by the same HostState spend that increments
  // next_client_sequence and commits the new client paths.
  when host_redeemer is {
    CreateClient { .. } -> True
    _ -> False
  }
}

fn authenticated_client(
  inputs: List<Input>,
  client_token: AuthToken,
  own_policy: PolicyId,
  host_policy: PolicyId,
  client_script: Hash<Blake2b_224, Script>,
) -> (Input, ClientDatum) {
  expect client_token.policy_id == own_policy
  let sequence = auth.extract_token_sequence(client_token.name)
  expect string_utils.is_uint_string(sequence)
  expect
    client_token.name == auth.generate_token_name(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      client_prefix,
      sequence,
    )
  expect [input] =
    list.filter(
      inputs,
      fn(input) { auth.contain_auth_token(input.output, client_token) },
    )
  expect
    input.output.address.payment_credential == address.Script(client_script)
  expect datum: ClientDatum = validator_utils.get_inline_datum(input.output)
  expect datum.token == client_token
  expect client_datum.has_singleton_history(datum)
  (input, datum)
}

fn archive_consensus_state(
  tx: Transaction,
  client_token: AuthToken,
  own_policy: PolicyId,
  host_policy: PolicyId,
  client_script: Hash<Blake2b_224, Script>,
  archive_script: Hash<Blake2b_224, Script>,
) -> Bool {
  expect Some(host_input) = find_host_state_input(tx.inputs, host_policy)
  expect Some(raw_host_redeemer) =
    pairs.get_first(tx.redeemers, Spend(host_input.output_reference))
  expect host_redeemer.UpdateClient {
    client_state_siblings,
    consensus_state_siblings,
    removed_consensus_state_siblings,
  }: HostStateRedeemer = raw_host_redeemer
  expect removed_consensus_state_siblings == []
  let (input, datum) =
    authenticated_client(
      tx.inputs,
      client_token,
      own_policy,
      host_policy,
      client_script,
    )
  expect Some(raw_client_redeemer) =
    pairs.get_first(tx.redeemers, Spend(input.output_reference))
  expect client_redeemer: SpendClientRedeemer = raw_client_redeemer
  expect [output] = transaction.find_script_outputs(tx.outputs, client_script)
  expect output.address == input.output.address
  expect auth.contain_auth_token(output, client_token)
  expect updated: ClientDatum = validator_utils.get_inline_datum(output)
  // The spend validator checks this message's Tendermint signatures. The
  // archive policy binds that exact message to the new checkpoint and metadata.
  expect
    when client_redeemer is {
      UpdateClient { msg } -> {
        expect HeaderCase(header) = msg
        client_datum.update_state(
          datum,
          updated,
          header,
          validator_utils.get_tx_valid_from(tx.validity_range),
        )
      }
      RecoverClient { .. } -> True
    }
  expect updated.token == client_token
  expect client_datum.has_singleton_history(updated)
  expect
    height.compare(
      updated.state.client_state.latest_height,
      datum.state.client_state.latest_height,
    ) == Greater
  let record = consensus_history.from_client(datum)
  let archive_token = consensus_history.token(client_token, record.height)
  expect [archive_output] =
    list.filter(
      tx.outputs,
      fn(output) { auth.contain_auth_token(output, archive_token) },
    )
  expect archive_output.address == address.from_script(archive_script)
  expect archived: ConsensusStateDatum =
    validator_utils.get_inline_datum(archive_output)
  expect old_host: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  let host_output =
    validator_utils.find_unique_continuation_output(
      host_input.output,
      tx.outputs,
      AuthToken { policy_id: host_policy, name: host_state_token_name },
    )
  expect new_host: HostStateDatum =
    validator_utils.get_inline_datum(host_output)
  let client_id =
    bytearray.concat(
      "07-tendermint-",
      auth.extract_token_sequence(client_token.name),
    )
  let root_after_client =
    ibc_state_commitment.apply_update(
      old_host.state.ibc_state_root,
      client_keys.full_client_state_path(client_id),
      cbor.serialise(datum.state.client_state),
      cbor.serialise(updated.state.client_state),
      client_state_siblings,
    )
  expect [Pair(new_height, new_consensus)] = updated.state.consensus_states
  and {
    archived.client_token == record.client_token,
    archived.height == record.height,
    archived.consensus_state == record.consensus_state,
    archived.processed_time == record.processed_time,
    archived.processed_height == record.processed_height,
    auth.contains_only_auth_tokens(archive_output, [archive_token]),
    validator_utils.require_exact_marker_mint(
      tx.mint,
      own_policy,
      archive_token.name,
      1,
    ),
    ibc_state_commitment.apply_update(
      root_after_client,
      client_keys.full_client_consensus_state_path(
        client_id,
        string_utils.int_to_string(new_height.revision_height),
      ),
      "",
      cbor.serialise(new_consensus),
      consensus_state_siblings,
    ) == new_host.state.ibc_state_root,
  }
}

fn prune_consensus_state(
  tx: Transaction,
  client_token: AuthToken,
  record_height: height.Height,
  own_policy: PolicyId,
  host_policy: PolicyId,
  client_script: Hash<Blake2b_224, Script>,
  archive_script: Hash<Blake2b_224, Script>,
) -> Bool {
  expect Some(host_input) = find_host_state_input(tx.inputs, host_policy)
  expect Some(raw_host_redeemer) =
    pairs.get_first(tx.redeemers, Spend(host_input.output_reference))
  expect host_redeemer.PruneConsensusState {
    client_token: host_client,
    height: host_height,
    consensus_state_siblings,
  }: HostStateRedeemer = raw_host_redeemer
  expect host_client == client_token && host_height == record_height
  let (_, client) =
    authenticated_client(
      tx.reference_inputs,
      client_token,
      own_policy,
      host_policy,
      client_script,
    )
  let archive_token = consensus_history.token(client_token, record_height)
  expect [input] =
    list.filter(
      tx.inputs,
      fn(input) { auth.contain_auth_token(input.output, archive_token) },
    )
  expect input.output.address == address.from_script(archive_script)
  expect record: ConsensusStateDatum =
    validator_utils.get_inline_datum(input.output)
  let now = validator_utils.get_tx_valid_from(tx.validity_range) * 1_000_000
  expect old_host: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  let host_output =
    validator_utils.find_unique_continuation_output(
      host_input.output,
      tx.outputs,
      AuthToken { policy_id: host_policy, name: host_state_token_name },
    )
  expect new_host: HostStateDatum =
    validator_utils.get_inline_datum(host_output)
  let client_id =
    bytearray.concat(
      "07-tendermint-",
      auth.extract_token_sequence(client_token.name),
    )
  and {
    record.client_token == client_token,
    record.height == record_height,
    height.compare(record_height, client.state.client_state.latest_height) == Less,
    client_state.is_expired(
      client.state.client_state,
      record.consensus_state.timestamp,
      now,
    ),
    validator_utils.require_exact_marker_mint(
      tx.mint,
      own_policy,
      archive_token.name,
      -1,
    ),
    ibc_state_commitment.apply_update(
      old_host.state.ibc_state_root,
      client_keys.full_client_consensus_state_path(
        client_id,
        string_utils.int_to_string(record_height.revision_height),
      ),
      cbor.serialise(record.consensus_state),
      "",
      consensus_state_siblings,
    ) == new_host.state.ibc_state_root,
  }
}

validator mint_client_stt(
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
  consensus_state_script_hash: Hash<Blake2b_224, Script>,
) {
  mint(
    redeemer: MintClientRedeemer,
    client_mint_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    when redeemer is {
      ArchiveConsensusState { client_token } ->
        archive_consensus_state(
          transaction,
          client_token,
          client_mint_policy_id,
          host_state_nft_policy_id,
          spend_client_script_hash,
          consensus_state_script_hash,
        )
      PruneConsensusState { client_token, height } ->
        prune_consensus_state(
          transaction,
          client_token,
          height,
          client_mint_policy_id,
          host_state_nft_policy_id,
          spend_client_script_hash,
          consensus_state_script_hash,
        )
      MintClient -> {
        let Transaction { inputs, outputs, mint, validity_range, redeemers, .. } =
          transaction

        expect Some(host_state_input) =
          find_host_state_input(inputs, host_state_nft_policy_id)

        expect InlineDatum(datum) = host_state_input.output.datum
        expect host_state_datum: HostStateDatum = datum
        let client_id_sequence = host_state_datum.state.next_client_sequence

        // Generate client token name using the HostState NFT as base token
        let host_state_nft =
          AuthToken {
            policy_id: host_state_nft_policy_id,
            name: host_state_token_name,
          }
        let id_str = string_utils.int_to_string(client_id_sequence)
        let client_token_name =
          auth.generate_token_name(host_state_nft, client_prefix, id_str)
        let client_token =
          AuthToken {
            policy_id: client_mint_policy_id,
            name: client_token_name,
          }

        expect [client_output] =
          transaction.find_script_outputs(outputs, spend_client_script_hash)

        expect client_output_datum: ClientDatum =
          validator_utils.get_inline_datum(client_output)
        let valid_output_datum =
          client_output_datum
            |> client_datum.is_initialized_valid(client_token)

        let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
        let tx_valid_from = validator_utils.get_tx_valid_from(validity_range)
        let processed_time = tx_valid_from * 1_000_000
        let processed_height =
          client_datum.processed_height_from_time(processed_time)
        let latest_height =
          client_state.get_latest_height(client_output_datum.state.client_state)
        expect Some(datum_processed_time) =
          pairs.get_first(
            client_output_datum.state.processed_times,
            latest_height,
          )
        expect Some(datum_processed_height) =
          pairs.get_first(
            client_output_datum.state.processed_heights,
            latest_height,
          )
        let is_state_active =
          client_state.status(
            client_output_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_output_datum.state.consensus_states,
          ) == Active

        and {
          auth.mint_auth_token(mint, client_token)?,
          auth.contains_only_auth_tokens(client_output, [client_token])?,
          valid_output_datum?,
          datum_processed_time == processed_time,
          datum_processed_height == processed_height,
          is_state_active?,
          spent_host_state_for_create_client(redeemers, host_state_input)?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
