use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/heartbeat.{HeartbeatSchedule}
use ibc/core/ics_025_handler_interface/host_state as host
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateChannel, CreateClient, CreateConnection, HandlePacket, Heartbeat,
  HostStateRedeemer, UpdateChannel, UpdateClient, UpdateConnection,
  UpgradeChannel,
}
use ibc/implementation/host_state_stt
use ibc/migration/auth as migration
use ibc/utils/validator_utils

validator host_state(
  registry_policy: ByteArray,
  generation: Int,
  heartbeat_schedule: HeartbeatSchedule,
  shutdown_authority: ByteArray,
  shutdown_host_policy: ByteArray,
) {
  spend(
    // Keep the canonical datum schema in the blueprint for the wire schema lock.
    _datum: Option<host.HostStateDatum>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      migration.migration_witness(transaction, registry_policy)
    } else if migration.is_host_control(raw) {
      expect Some(input) = transaction.find_input(transaction.inputs, own_ref)
      expect
        assets.has_nft(
          input.output.value,
          shutdown_host_policy,
          host.host_state_token_name,
        )
      if raw == builtin.constr_data(9, []) {
        // The immutable NFT policy validates deployer, grace, drained ports and counts.
        assets.quantity_of(
          transaction.mint,
          shutdown_host_policy,
          host.host_state_token_name,
        ) == -1
      } else {
        // The fixed authority authenticates the current registry, HostState and transition.
        migration.host_control_witness(transaction, shutdown_authority)
      }
    } else {
      let registry = migration.recovery_registry(transaction, registry_policy)
      expect registry.current.generation == generation
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
      // Decode the role addresses once for authentication and state transitions.
      // Every role address must exist; each needed credential is still decoded.
      expect [
        host_address, client_address, connection_address, channel_address, _,
      ] = registry.current.addresses
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
      let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
      // Reuse the decoded HostState role address instead of looking it up again.
      let own_input =
        list.expect_find(
          inputs,
          fn(input) { input.output_reference == own_ref },
        )
      let own_address: Data = own_input.output.address
      expect own_address == host_address
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
        UpdateClient { client_state_siblings, consensus_state_siblings } ->
          and {
            // Client updates should not change HostState sequencing, only the root.
            host.validate_update_only_root(old_datum, new_datum),
            host_state_stt.validate_update_client_root(
              old_datum,
              new_datum,
              inputs,
              outputs,
              mint,
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
        UpgradeChannel -> and {
            host.validate_update_only_root(old_datum, new_datum),
            host_state_stt.validate_upgrade_channel(
              old_datum,
              inputs,
              outputs,
              redeemers,
              spend_channel_script_hash,
              channel_policy_id,
            ),
          }
        Heartbeat ->
          host.validate_heartbeat(
            old_datum,
            new_datum,
            transaction.validity_range,
            heartbeat_schedule,
          )
        // Shutdown uses the fixed authority above. Deployer handover is governed.
        _ -> fail
      }
    }
  }

  else(_) {
    fail
  }
}
