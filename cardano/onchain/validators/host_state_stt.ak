use aiken/collection/list
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name, validate_bind_port,
  validate_create_channel, validate_create_client, validate_create_connection,
  validate_enter_shutdown, validate_finalize_shutdown, validate_heartbeat,
  validate_update_only_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  AuthorizeFinalization, BindPort, CreateChannel, CreateClient, CreateConnection,
  EnterShutdown, FinalizeShutdown, HandlePacket, Heartbeat, HostStateRedeemer,
  UpdateChannel, UpdateClient, UpdateConnection,
}
use ibc/implementation/host_state_stt.{
  decode_host_state_datum, find_host_state_input, find_host_state_output,
  validate_bind_port_root, validate_create_channel_root,
  validate_create_client_root, validate_create_connection_root,
  validate_handle_packet_root, validate_transfer_finalization_authorization,
  validate_update_channel_root, validate_update_client_root,
  validate_update_connection_root,
} as implementation
use ibc/utils/validator_utils

validator host_state_stt(
  nft_policy: PolicyId,
  client_registry: Data,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  client_policy_id: PolicyId,
  connection_policy_id: PolicyId,
  channel_policy_id: PolicyId,
) {
  spend(
    _datum_opt: Option<HostStateDatum>,
    redeemer: HostStateRedeemer,
    _spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    // 1. Extract transaction fields
    let Transaction {
      inputs,
      outputs,
      mint,
      redeemers,
      extra_signatories,
      validity_range,
      ..
    } = transaction
    // 2. Find input HostState UTXO
    let host_input = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    // 3. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy

    // 4. Validate state transition based on operation.
    when redeemer is {
      FinalizeShutdown -> and {
          list.has(extra_signatories, old_datum.deployer),
          validate_finalize_shutdown(
            old_datum,
            validator_utils.get_tx_valid_from(validity_range),
          ),
          validator_utils.require_exact_marker_mint(
            mint,
            nft_policy,
            host_state_token_name,
            -1,
          ),
          list.all(
            outputs,
            fn(output) {
              quantity_of(output.value, nft_policy, host_state_token_name) == 0
            },
          ),
        }
      _ -> {
        // Non-final transitions must re-create exactly one HostState UTxO.
        let host_output = find_host_state_output(outputs, nft_policy)
        let new_datum = decode_host_state_datum(host_output)

        // The HostState NFT must remain locked at the HostState script address.
        //
        // In practice, this means the output that carries the NFT must stay at the
        // same address as the spent HostState UTxO.
        expect host_output.address == host_input.output.address
        expect
          validator_utils.preserves_state_value(
            host_input.output.value,
            host_output.value,
          )

        // Each transition below preserves the authenticated input's NFT policy.
        when redeemer is {
          CreateClient { client_state_siblings, consensus_state_siblings } ->
            and {
              validate_create_client(old_datum, new_datum),
              validate_create_client_root(
                old_datum,
                new_datum,
                outputs,
                mint,
                client_registry,
                client_policy_id,
                client_state_siblings,
                consensus_state_siblings,
              ),
            }
          CreateConnection { connection_siblings } -> and {
              validate_create_connection(old_datum, new_datum),
              validate_create_connection_root(
                old_datum,
                new_datum,
                outputs,
                mint,
                spend_connection_script_hash,
                connection_policy_id,
                connection_siblings,
              ),
            }
          CreateChannel {
            channel_siblings,
            next_sequence_send_siblings,
            next_sequence_recv_siblings,
            next_sequence_ack_siblings,
          } -> and {
              validate_create_channel(old_datum, new_datum),
              validate_create_channel_root(
                old_datum,
                new_datum,
                outputs,
                mint,
                spend_channel_script_hash,
                channel_policy_id,
                channel_siblings,
                next_sequence_send_siblings,
                next_sequence_recv_siblings,
                next_sequence_ack_siblings,
              ),
            }
          BindPort { port_id, registration, port_siblings } -> and {
              // A permanent global registration is an administrative action.
              // Requiring the deployment authority prevents port squatting and
              // makes the protocol-wide bound useful rather than attacker-fillable.
              list.has(extra_signatories, old_datum.deployer),
              validate_bind_port(old_datum, new_datum, port_id, registration),
              validate_bind_port_root(
                old_datum,
                new_datum,
                port_id,
                registration,
                implementation.find_state_output(
                  outputs,
                  registration.module_script_hash,
                ),
                port_siblings,
              ),
            }
          UpdateClient { client_state_siblings, consensus_state_siblings } ->
            and {
              // Client updates should not change HostState sequencing, only the root.
              validate_update_only_root(old_datum, new_datum),
              validate_update_client_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                transaction.mint,
                client_registry,
                client_policy_id,
                client_state_siblings,
                consensus_state_siblings,
              ),
            }
          UpdateConnection { connection_siblings } -> and {
              validate_update_only_root(old_datum, new_datum),
              validate_update_connection_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                spend_connection_script_hash,
                connection_policy_id,
                connection_siblings,
              ),
            }
          UpdateChannel { channel_siblings } -> and {
              // Channel updates should not change HostState sequencing, only the root.
              validate_update_only_root(old_datum, new_datum),
              validate_update_channel_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                spend_channel_script_hash,
                channel_policy_id,
                channel_siblings,
              ),
            }
          HandlePacket {
            channel_siblings,
            next_sequence_send_siblings,
            next_sequence_recv_siblings,
            next_sequence_ack_siblings,
            packet_commitment_siblings,
            packet_receipt_siblings,
            packet_acknowledgement_siblings,
          } -> and {
              // Packet operations should not change HostState sequencing, only the root.
              validate_update_only_root(old_datum, new_datum),
              validate_handle_packet_root(
                old_datum,
                new_datum,
                inputs,
                outputs,
                redeemers,
                spend_channel_script_hash,
                channel_policy_id,
                channel_siblings,
                next_sequence_send_siblings,
                next_sequence_recv_siblings,
                next_sequence_ack_siblings,
                packet_commitment_siblings,
                packet_receipt_siblings,
                packet_acknowledgement_siblings,
              ),
            }
          EnterShutdown { grace_period_end } -> and {
              list.has(extra_signatories, old_datum.deployer),
              validate_enter_shutdown(
                old_datum,
                new_datum,
                grace_period_end,
                validator_utils.get_tx_valid_to(validity_range),
              ),
            }
          Heartbeat -> and {
              list.has(extra_signatories, old_datum.deployer),
              validate_heartbeat(old_datum, new_datum),
            }
          AuthorizeFinalization -> and {
              list.has(extra_signatories, old_datum.deployer),
              validate_transfer_finalization_authorization(
                old_datum,
                new_datum,
                inputs,
                mint,
                validator_utils.get_tx_valid_from(validity_range),
              ),
            }
          FinalizeShutdown -> fail
        }
      }
    }
  }

  else(_) {
    fail @"HostState STT can only be spent"
  }
}
