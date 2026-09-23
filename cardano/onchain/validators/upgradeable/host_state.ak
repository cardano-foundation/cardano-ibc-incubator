use aiken/collection/dict
use aiken/collection/list
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/host_state as host
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BindPort, CreateChannel, CreateClient, CreateConnection, HandlePacket,
  Heartbeat, HostStateRedeemer, UpdateChannel, UpdateClient, UpdateConnection,
}
use ibc/implementation/host_state_stt
use ibc/migration/auth as migration
use ibc/migration/types.{host_role, transfer_role}
use ibc/utils/validator_utils

validator host_state(registry_policy: ByteArray, generation: Int) {
  spend(
    _datum: Option<Data>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      migration.migration_witness(transaction, registry_policy)
    } else {
      let registry =
        migration.active_spend(
          transaction,
          registry_policy,
          generation,
          host_role,
          own_ref,
        )
      expect
        !registry.preparing || assets.tokens(
          transaction.mint,
          registry.identity.escrow_policy,
        ) == dict.empty
      expect redeemer: HostStateRedeemer = raw
      expect
        when redeemer is {
          Heartbeat -> migration.permitted(registry.restrictions, 4)
          UpdateClient { .. } -> migration.permitted(registry.restrictions, 2)
          CreateClient { .. } ->
            migration.permitted(registry.restrictions, 1) && migration.permitted(
              registry.restrictions,
              2,
            )
          _ -> migration.permitted(registry.restrictions, 1)
        }
      // Decode this common prefix once instead of three indexed traversals.
      // The same four addresses must exist; each credential is still decoded.
      expect [_,
        client_address,
        connection_address, channel_address, ..] = registry.current.addresses
      // Keep transaction decoding in the entry point to fit reference publication.
      let nft_policy = registry.host_policy
      let client_registry: Data = migration.encoded_address_hash(client_address)
      let spend_connection_script_hash =
        migration.encoded_address_hash(connection_address)
      let spend_channel_script_hash =
        migration.encoded_address_hash(channel_address)
      let client_policy_id = registry.identity.client_policy
      let connection_policy_id = registry.identity.connection_policy
      let channel_policy_id = registry.identity.channel_policy
      // 1. Extract transaction fields
      let Transaction {
        inputs,
        outputs,
        mint,
        redeemers,
        extra_signatories,
        ..
      } = transaction
      // 2. Find input HostState UTXO
      let host_input = host_state_stt.find_host_state_input(inputs, nft_policy)
      let old_datum = host_state_stt.decode_host_state_datum(host_input.output)
      // 3. Verify NFT policy matches
      expect old_datum.nft_policy == nft_policy
      // 4. Validate state transition based on operation.
      // Non-final transitions must re-create exactly one HostState UTxO.
      let host_output =
        host_state_stt.find_host_state_output(outputs, nft_policy)
      let new_datum = host_state_stt.decode_host_state_datum(host_output)
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
            host.validate_create_client(old_datum, new_datum),
            host_state_stt.validate_create_client_root(
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
            host.validate_create_connection(old_datum, new_datum),
            host_state_stt.validate_create_connection_root(
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
            host.validate_create_channel(old_datum, new_datum),
            host_state_stt.validate_create_channel_root(
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
        BindPort { port_id, registration, port_siblings } -> {
          // Select the singleton once for both address authentication and its commitment.
          let module_output =
            host_state_stt.find_state_output(
              outputs,
              registration.module_script_hash,
            )
          expect
            if port_id == "transfer" {
              let actual_address: Data = module_output.address
              and {
                registration.module_script_hash == migration.active_role_hash(
                  registry.current,
                  transfer_role,
                ),
                actual_address == migration.active_role_address(
                  registry.current,
                  transfer_role,
                ),
              }
            } else {
              True
            }
          and {
            // A permanent global registration is an administrative action.
            // Requiring the deployment authority prevents port squatting and
            // makes the protocol-wide bound useful rather than attacker-fillable.
            list.has(extra_signatories, old_datum.deployer),
            host.validate_bind_port(old_datum, new_datum, port_id, registration),
            host_state_stt.validate_bind_port_root(
              old_datum,
              new_datum,
              port_id,
              registration,
              module_output,
              port_siblings,
            ),
          }
        }
        UpdateClient { client_state_siblings, consensus_state_siblings } ->
          and {
            // Client updates should not change HostState sequencing, only the root.
            host.validate_update_only_root(old_datum, new_datum),
            host_state_stt.validate_update_client_root(
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
            host.validate_update_only_root(old_datum, new_datum),
            host_state_stt.validate_update_connection_root(
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
            host.validate_update_only_root(old_datum, new_datum),
            host_state_stt.validate_update_channel_root(
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
            host.validate_update_only_root(old_datum, new_datum),
            host_state_stt.validate_handle_packet_root(
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
        Heartbeat -> and {
            list.has(extra_signatories, old_datum.deployer),
            host.validate_heartbeat(old_datum, new_datum),
          }
        // Shutdown and finalization belong only to immutable deployments.
        _ -> fail
      }
    }
  }

  else(_) {
    fail
  }
}
