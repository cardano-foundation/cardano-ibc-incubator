// IBC Connection Minting Validator - STT Architecture
// Simplified version - validates HostState NFT presence and basic connection setup

use aiken/collection/list
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, Input, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/client_redeemer.{MintClientRedeemer}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_003_connection_semantics/connection_datum.{
  ConnectionDatum, is_conn_open_init_valid,
}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  MintConnectionRedeemer,
}
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
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

validator mint_connection_stt(
  client_minting_policy_id: PolicyId,
  _verify_proof_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
) {
  mint(
    _redeemer: MintConnectionRedeemer,
    connection_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      mint,
      validity_range,
      ..
    } = transaction

    expect Some(host_state_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)

    expect InlineDatum(datum) = host_state_input.output.datum
    expect host_state_datum: HostStateDatum = datum
    let connection_id_sequence = host_state_datum.state.next_connection_sequence

    expect [connection_output] =
      outputs
        |> transaction.find_script_outputs(spend_connection_script_hash)
    expect connection_output_datum: ConnectionDatum =
      validator_utils.get_inline_datum(connection_output)

    let client_datum =
      validator_utils.validate_referred_client(
        reference_inputs,
        connection_output_datum.token.name,
        client_minting_policy_id,
        connection_output_datum.state.client_id,
      )

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    let client_state_active =
      client_state.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == Active

    let id_str = string_utils.int_to_string(connection_id_sequence)
    let host_state_nft = AuthToken {
      policy_id: host_state_nft_policy_id,
      name: host_state_token_name,
    }
    let connection_token_name =
      auth.generate_token_name(host_state_nft, conn_keys.connection_prefix, id_str)
    let connection_token =
      AuthToken {
        policy_id: connection_minting_policy_id,
        name: connection_token_name,
      }

    and {
      client_state_active?,
      (mint |> auth.mint_auth_token(connection_token))?,
      (connection_output |> auth.contains_only_auth_tokens([connection_token]))?,
      is_conn_open_init_valid(connection_output_datum, connection_token)?,
    }
  }

  else(_) {
    fail
  }
}
