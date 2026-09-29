use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/transfer_module_datum.{TransferModuleDatum}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostStateDatum, ModuleRegistration, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/migration/auth as migration
use ibc/migration/types.{
  Activate, Begin, Cancel, CancelRestoration, Counts, Emergency, MoveCore,
  MoveEscrow, MoveTransferRoot, Moving, Propose, ProposeEmergencyRotation,
  ProposeRestoration, Proposed, Ready, Registry, RegistryRedeemer, Replace,
  Restoration, Restore, Restrict, Rotate, RotateAuthority, host_role,
  transfer_role,
}
use ibc/utils/string
use ibc/utils/validator_utils

// All migrated objects use the ordinary raw datum/redeemer ABI. Only the
// reserved migration spend constructor is new. Ordinary verification remains
// in the original production validators.

fn script_inputs(transaction: Transaction) -> List<Input> {
  list.filter(
    transaction.inputs,
    fn(input) {
      when input.output.address.payment_credential is {
        Script(_) -> True
        _ -> False
      }
    },
  )
}

fn control_only(transaction: Transaction) -> Bool {
  list.length(script_inputs(transaction)) == 1
}

fn object_input(transaction: Transaction, own_ref: OutputReference) -> Input {
  expect [input] =
    list.filter(
      script_inputs(transaction),
      fn(input) { input.output_reference != own_ref },
    )
  input
}

fn host_input(transaction: Transaction, registry: Registry) -> Input {
  migration.unique_input(
    transaction.inputs,
    AuthToken { policy_id: registry.host_policy, name: host_state_token_name },
  )
}

fn moved_object(
  transaction: Transaction,
  registry: Registry,
  own_ref: OutputReference,
  role: Int,
  token: AuthToken,
) -> Bool {
  expect Moving { target, .. } = registry.phase
  let input = object_input(transaction, own_ref)
  expect input.output.address == migration.role_address(registry.current, role)
  expect migration.contains(input.output, token)
  expect InlineDatum(_) = input.output.datum
  let output = migration.unique_output(transaction.outputs, token)
  migration.preserved_output(
    input,
    output,
    migration.role_address(target, role),
  )
}

fn host_output_matches(
  transaction: Transaction,
  registry: Registry,
  input: Input,
  expected: HostStateDatum,
  target_address,
) -> Bool {
  let output =
    migration.unique_output(
      transaction.outputs,
      AuthToken { policy_id: registry.host_policy, name: host_state_token_name },
    )
  and {
    output.address == target_address,
    output.datum == InlineDatum(expected),
    output.reference_script == input.output.reference_script,
    validator_utils.preserves_state_value(input.output.value, output.value),
  }
}

fn proposal_ready(transaction: Transaction, registry: Registry) -> Bool {
  expect Proposed { ready_at, expires_at, .. } = registry.phase
  and {
    validator_utils.get_tx_valid_from(transaction.validity_range) >= ready_at,
    validator_utils.get_tx_valid_to(transaction.validity_range) <= expires_at,
  }
}

validator implementation_registry {
  spend(
    datum: Option<Registry>,
    redeemer: RegistryRedeemer,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(old) = datum
    expect Some(own_input) = transaction.find_input(transaction.inputs, own_ref)
    expect migration.contains(own_input.output, old.token)
    expect migration.unique_input(transaction.inputs, old.token) == own_input
    let output = migration.unique_output(transaction.outputs, old.token)
    expect new: Registry = validator_utils.get_inline_datum(output)
    expect output.address == own_input.output.address
    expect output.reference_script == own_input.output.reference_script
    expect
      validator_utils.preserves_state_value(
        own_input.output.value,
        output.value,
      )
    // Costs come from independently signed wallet inputs. No protocol issue,
    // burn, callback side effect, or additional script spend can hide in a move.
    expect assets.flatten(transaction.mint) == []
    expect transaction.withdrawals == []
    expect transaction.certificates == []
    let valid_to = validator_utils.get_tx_valid_to(transaction.validity_range)
    expect
      validator_utils.get_tx_valid_from(transaction.validity_range) <= valid_to

    expect
      when redeemer is {
        Begin |
        MoveCore { .. } |
        MoveTransferRoot |
        MoveEscrow { .. } |
        Activate { .. } -> migration.permitted(old.emergency.mask, 8)
        _ -> True
      }
    when redeemer is {
      Restrict { mask } -> {
        expect control_only(transaction)
        expect
          migration.emergency_authorized(old.emergency.authority, transaction)
        expect migration.tightens(old.emergency.mask, mask)
        new == Registry {
          ..old,
          emergency: Emergency {
            ..old.emergency,
            epoch: old.emergency.epoch + 1,
            mask,
            restoration: when old.emergency.restoration is {
              Some(ticket) ->
                if ticket.mask == None {
                  Some(ticket)
                } else {
                  None
                }
              None -> None
            },
          },
        }
      }
      ProposeRestoration { mask, authority, expires_at } -> {
        expect control_only(transaction)
        expect migration.authorized(old.governance, transaction)
        expect migration.valid_mask(mask)
        expect migration.valid_authority(authority)
        expect migration.separate_authorities(old.governance, authority)
        let ready_at = valid_to + old.governance.delay_ms
        expect expires_at > ready_at
        new == Registry {
          ..old,
          emergency: Emergency {
            ..old.emergency,
            restoration: Some(
              Restoration {
                registry_nonce: old.nonce,
                generation: old.current.generation,
                epoch: old.emergency.epoch,
                mask: Some(mask),
                authority,
                ready_at,
                expires_at,
              },
            ),
          },
        }
      }
      // A compromised emergency quorum cannot veto its own delayed removal.
      // This approval never changes permissions, even after new restrictions.
      ProposeEmergencyRotation { authority, expires_at } -> {
        expect control_only(transaction)
        expect migration.authorized(old.governance, transaction)
        expect migration.valid_authority(authority)
        expect migration.separate_authorities(old.governance, authority)
        let ready_at = valid_to + old.governance.delay_ms
        expect expires_at > ready_at
        new == Registry {
          ..old,
          emergency: Emergency {
            ..old.emergency,
            restoration: Some(
              Restoration {
                registry_nonce: old.nonce,
                generation: old.current.generation,
                epoch: old.emergency.epoch,
                mask: None,
                authority,
                ready_at,
                expires_at,
              },
            ),
          },
        }
      }
      CancelRestoration -> {
        expect control_only(transaction)
        expect migration.authorized(old.governance, transaction)
        new == Registry {
          ..old,
          emergency: Emergency { ..old.emergency, restoration: None },
        }
      }
      Restore -> {
        expect control_only(transaction)
        expect Some(approval) = old.emergency.restoration
        expect
          approval.registry_nonce == old.nonce && approval.generation == old.current.generation
        let restored_mask =
          when approval.mask is {
            Some(mask) -> {
              expect approval.epoch == old.emergency.epoch
              mask
            }
            None -> old.emergency.mask
          }
        expect
          validator_utils.get_tx_valid_from(transaction.validity_range) >= approval.ready_at && valid_to <= approval.expires_at
        expect
          migration.separate_authorities(old.governance, approval.authority)
        new == Registry {
          ..old,
          emergency: Emergency {
            authority: approval.authority,
            epoch: old.emergency.epoch + 1,
            mask: restored_mask,
            restoration: None,
          },
        }
      }
      Propose { proposal, expires_at } -> {
        expect control_only(transaction)
        expect old.phase == Ready
        expect migration.authorized(old.governance, transaction)
        expect
          when proposal is {
            Replace {
              source_generation,
              nonce,
              target,
              maximum,
              escrow_inventory,
            } -> and {
                source_generation == old.current.generation,
                nonce == old.nonce + 1,
                target.generation == source_generation + 1,
                target.compatibility == old.current.compatibility,
                migration.valid_implementation(target),
                maximum.clients >= 0 && maximum.connections >= 0 && maximum.channels >= 0,
                bytearray.length(escrow_inventory) == 32,
                !list.any(
                  target.addresses,
                  fn(address) {
                    address == own_input.output.address || list.has(
                      old.current.addresses,
                      address,
                    )
                  },
                ),
              }
            Rotate { nonce, governance } -> and {
                nonce == old.nonce + 1,
                migration.valid_governance(governance),
                migration.separate_authorities(
                  governance,
                  old.emergency.authority,
                ),
              }
          }
        let ready_at = valid_to + old.governance.delay_ms
        expect expires_at > ready_at
        new == Registry {
          ..old,
          nonce: old.nonce + 1,
          phase: Proposed { proposal, ready_at, expires_at },
        }
      }
      Cancel -> {
        expect control_only(transaction)
        expect Proposed { expires_at, .. } = old.phase
        expect
          migration.authorized(old.governance, transaction) || validator_utils.get_tx_valid_from(
            transaction.validity_range,
          ) > expires_at
        new == Registry { ..old, phase: Ready }
      }
      RotateAuthority -> {
        expect control_only(transaction)
        expect proposal_ready(transaction, old)
        expect Proposed { proposal: Rotate { governance, .. }, .. } = old.phase
        expect
          migration.separate_authorities(governance, old.emergency.authority)
        new == Registry {
          ..old,
          governance,
          phase: Ready,
          emergency: Emergency { ..old.emergency, restoration: None },
        }
      }
      Begin -> {
        expect proposal_ready(transaction, old)
        expect Proposed {
          proposal: Replace { target, maximum, escrow_inventory, .. },
          ..
        } = old.phase
        expect
          list.all(
            target.addresses,
            fn(address) {
              expect Script(hash) = address.payment_credential
              list.any(
                transaction.reference_inputs,
                fn(reference) {
                  reference.output.address == old.identity.reference_holder && reference.output.reference_script == Some(
                    hash,
                  )
                },
              )
            },
          )
        let input = host_input(transaction, old)
        expect object_input(transaction, own_ref) == input
        expect
          input.output.address == migration.role_address(old.current, host_role)
        expect host: HostStateDatum =
          validator_utils.get_inline_datum(input.output)
        expect host.nft_policy == old.host_policy
        expect host.control.shutdown == Active
        expect Some(registration) =
          pairs.get_first(host.control.port_registry, "transfer")
        expect
          registration.module_script_hash == migration.role_hash(
            old.current,
            transfer_role,
          )
        let module_input =
          migration.unique_input(
            transaction.reference_inputs,
            registration.module_token,
          )
        expect
          module_input.output.address == migration.role_address(
            old.current,
            transfer_role,
          )
        expect migration.contains(module_input.output, registration.port_token)
        expect module_datum: TransferModuleDatum =
          validator_utils.get_inline_datum(module_input.output)
        expect module_datum.escrow_shard_registry_root == escrow_inventory
        expect host.state.next_client_sequence <= maximum.clients
        expect host.state.next_connection_sequence <= maximum.connections
        expect host.state.next_channel_sequence <= maximum.channels
        expect host.state.next_client_sequence >= 0
        expect host.state.next_connection_sequence >= 0
        expect host.state.next_channel_sequence >= 0
        expect
          host_output_matches(
            transaction,
            old,
            input,
            HostStateDatum {
              ..host,
              state: host_state.HostState {
                ..host.state,
                version: host.state.version + 1,
                last_update_time: valid_to,
              },
            },
            migration.role_address(target, host_role),
          )
        new == Registry {
          ..old,
          phase: Moving {
            target,
            limits: Counts {
              clients: host.state.next_client_sequence,
              connections: host.state.next_connection_sequence,
              channels: host.state.next_channel_sequence,
            },
            next: Counts { clients: 0, connections: 0, channels: 0 },
            registration,
            escrow_remaining: module_datum.escrow_shard_registry_root,
            module_moved: False,
          },
        }
      }
      MoveCore { role } -> {
        expect Moving {
          target,
          limits,
          next,
          registration,
          escrow_remaining,
          module_moved,
        } = old.phase
        let (sequence, limit, policy, prefix, next_counts) =
          when role is {
            1 ->
              (
                next.clients,
                limits.clients,
                old.identity.client_policy,
                "ibc_client",
                Counts { ..next, clients: next.clients + 1 },
              )
            2 ->
              (
                next.connections,
                limits.connections,
                old.identity.connection_policy,
                "connection",
                Counts { ..next, connections: next.connections + 1 },
              )
            3 ->
              (
                next.channels,
                limits.channels,
                old.identity.channel_policy,
                "channel",
                Counts { ..next, channels: next.channels + 1 },
              )
            _ -> fail @"Unsupported migration role"
          }
        expect sequence < limit
        let token =
          AuthToken {
            policy_id: policy,
            name: auth.generate_token_name(
              AuthToken {
                policy_id: old.host_policy,
                name: host_state_token_name,
              },
              prefix,
              string.int_to_string(sequence),
            ),
          }
        expect moved_object(transaction, old, own_ref, role, token)
        new == Registry {
          ..old,
          phase: Moving {
            target,
            limits,
            next: next_counts,
            registration,
            escrow_remaining,
            module_moved,
          },
        }
      }
      MoveTransferRoot -> {
        expect Moving {
          target,
          limits,
          next,
          registration,
          escrow_remaining,
          module_moved,
        } = old.phase
        expect !module_moved
        let input = object_input(transaction, own_ref)
        expect migration.contains(input.output, registration.port_token)
        expect
          moved_object(
            transaction,
            old,
            own_ref,
            transfer_role,
            registration.module_token,
          )
        new == Registry {
          ..old,
          phase: Moving {
            target,
            limits,
            next,
            registration,
            escrow_remaining,
            module_moved: True,
          },
        }
      }
      MoveEscrow { siblings } -> {
        expect Moving {
          target,
          limits,
          next,
          registration,
          escrow_remaining,
          module_moved,
        } = old.phase
        let input = object_input(transaction, own_ref)
        expect escrow: TransferEscrowDatum =
          validator_utils.get_inline_datum(input.output)
        let token =
          AuthToken {
            policy_id: old.identity.escrow_policy,
            name: transfer_escrow_shard.shard_token_name(
              escrow.channel_id,
              escrow.denom,
            ),
          }
        expect moved_object(transaction, old, own_ref, transfer_role, token)
        let remaining =
          ibc_state_commitment.apply_update(
            escrow_remaining,
            transfer_escrow_shard.shard_registry_key(
              escrow.channel_id,
              escrow.denom,
            ),
            transfer_escrow_shard.registered_shard_value,
            "",
            siblings,
          )
        new == Registry {
          ..old,
          phase: Moving {
            target,
            limits,
            next,
            registration,
            escrow_remaining: remaining,
            module_moved,
          },
        }
      }
      Activate { port_siblings } -> {
        expect Moving {
          target,
          limits,
          next,
          registration,
          escrow_remaining,
          module_moved,
        } = old.phase
        expect next == limits
        expect module_moved
        expect escrow_remaining == ibc_state_commitment.empty_hash
        let input = host_input(transaction, old)
        expect object_input(transaction, own_ref) == input
        expect input.output.address == migration.role_address(target, host_role)
        expect host: HostStateDatum =
          validator_utils.get_inline_datum(input.output)
        expect host.nft_policy == old.host_policy
        expect host.control.shutdown == Active
        expect
          pairs.get_first(host.control.port_registry, "transfer") == Some(
            registration,
          )
        let updated_registration =
          ModuleRegistration {
            ..registration,
            module_script_hash: migration.role_hash(target, transfer_role),
          }
        let root =
          ibc_state_commitment.apply_update(
            host.state.ibc_state_root,
            "ports/transfer",
            cbor.serialise(registration),
            cbor.serialise(updated_registration),
            port_siblings,
          )
        let updated_ports =
          pairs.map(
            host.control.port_registry,
            fn(port, registered) {
              if port == "transfer" {
                updated_registration
              } else {
                registered
              }
            },
          )
        expect
          host_output_matches(
            transaction,
            old,
            input,
            HostStateDatum {
              ..host,
              state: host_state.HostState {
                ..host.state,
                version: host.state.version + 1,
                last_update_time: valid_to,
                ibc_state_root: root,
              },
              control: host_state.HostStateControl {
                ..host.control,
                port_registry: updated_ports,
              },
            },
            migration.role_address(target, host_role),
          )
        new == Registry { ..old, current: target, phase: Ready }
      }
    }
  }

  else(_) {
    fail
  }
}
