// HostState is the single coordinator UTxO for IBC object creation and root updates.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/address as address
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction, find_input,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer, Operator}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ModuleRegistration, ReferenceScriptIdentity,
  host_state_token_name, is_host_state_reclaimable_with_terminal_reference,
  validate_bind_port, validate_create_channel, validate_create_client,
  validate_create_connection, validate_enter_shutdown,
  validate_finalize_reference_script_registration, validate_heartbeat,
  validate_reclaim_channel, validate_reclaim_client, validate_reclaim_connection,
  validate_reclaim_module, validate_reclaim_reference_scripts,
  validate_reference_inventory_preserved, validate_register_reference_scripts,
  validate_seal_shutdown, validate_update_client, validate_update_module_state,
  validate_update_only_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BeginChannelAbandonment, BeginConnectionRetirement, BindPort, CreateChannel,
  CreateClient, CreateConnection, EnterShutdown,
  FinalizeReferenceScriptRegistration, FinalizeShutdown, HandlePacket, Heartbeat,
  HostStateRedeemer, PruneTerminalClient, ReclaimChannel, ReclaimClient,
  ReclaimConnection, ReclaimHostState, ReclaimModule, ReclaimReferenceScripts,
  RegisterReferenceScripts, SealShutdown, UpdateChannel, UpdateClient,
  UpdateConnection, UpdateModuleState,
}
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  lifecycle_marker_token_name,
}
use ibc/utils/validator_utils

/// Find the HostState UTXO input being spent
/// 
/// Returns the input that contains the IBC Host State NFT
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

/// Find the HostState UTXO output being created
/// 
/// Returns the output that contains the IBC Host State NFT
fn find_host_state_output(outputs: List<Output>, nft_policy: PolicyId) -> Output {
  // Selecting the singleton directly preserves the uniqueness invariant while
  // avoiding the previous follow-up count over every transaction output.
  expect [host_output] =
    list.filter(
      outputs,
      fn(output) {
        assets.has_nft(output.value, nft_policy, host_state_token_name)
      },
    )
  host_output
}

fn inputs_at_script(
  inputs: List<Input>,
  script_hash: Hash<Blake2b_224, Script>,
) -> List<Input> {
  list.filter(
    inputs,
    fn(input) {
      when input.output.address.payment_credential is {
        address.Script(actual_hash) -> actual_hash == script_hash
        _ -> False
      }
    },
  )
}

fn reference_script_inputs_at_script(
  inputs: List<Input>,
  script_hash: Hash<Blake2b_224, Script>,
) -> List<Input> {
  inputs_at_script(inputs, script_hash)
    |> list.filter(
        fn(input) {
          when input.output.reference_script is {
            Some(_) -> True
            None -> False
          }
        },
      )
}

fn reference_script_identities_at_script(
  inputs: List<Input>,
  script_hash: Hash<Blake2b_224, Script>,
) -> List<ReferenceScriptIdentity> {
  reference_script_inputs_at_script(inputs, script_hash)
    |> list.map(
        fn(input) {
          expect Some(reference_script_hash) = input.output.reference_script
          ReferenceScriptIdentity {
            output_reference: input.output_reference,
            reference_script_hash,
          }
        },
      )
}

fn selected_reference_script_identities_at_script(
  inputs: List<Input>,
  script_hash: Hash<Blake2b_224, Script>,
  output_references: List<OutputReference>,
) -> List<ReferenceScriptIdentity> {
  list.map(
    output_references,
    fn(output_reference) {
      expect Some(input) = find_input(inputs, output_reference)
      expect
        input.output.address.payment_credential == address.Script(script_hash)
      expect Some(reference_script_hash) = input.output.reference_script
      ReferenceScriptIdentity { output_reference, reference_script_hash }
    },
  )
}

fn module_input_for_registration(
  inputs: List<Input>,
  registration: ModuleRegistration,
) -> Input {
  expect [module_input] =
    list.filter(
      inputs,
      fn(input) {
        and {
          input.output.address.payment_credential == address.Script(
            registration.module_script_hash,
          ),
          auth.contains_only_auth_tokens(
            input.output,
            [registration.port_token, registration.module_token],
          ),
        }
      },
    )
  module_input
}

fn validate_module_operator(
  host_datum: HostStateDatum,
  port_id: ByteArray,
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> Bool {
  expect Some(registration) =
    pairs.get_first(host_datum.state.bound_port, port_id)
  let module_input = module_input_for_registration(inputs, registration)

  when module_input_redeemer(module_input, redeemers) is {
    Operator(_) -> True
    _ -> False
  }
}

fn module_input_redeemer(
  module_input: Input,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> IBCModuleRedeemer {
  expect Some(module_redeemer_data) =
    pairs.get_first(redeemers, Spend(module_input.output_reference))
  expect module_redeemer: IBCModuleRedeemer = module_redeemer_data
  module_redeemer
}

/// Decode HostStateDatum from inline datum
fn decode_host_state_datum(output: Output) -> HostStateDatum {
  expect InlineDatum(datum) = output.datum
  expect decoded_datum: HostStateDatum = datum
  decoded_datum
}

fn preserves_lifecycle_marker(
  input: Output,
  output: Output,
  mint: Value,
  policy: PolicyId,
) -> Bool {
  quantity_of(output.value, policy, lifecycle_marker_token_name) == quantity_of(
    input.value,
    policy,
    lifecycle_marker_token_name,
  ) + quantity_of(mint, policy, lifecycle_marker_token_name)
}

fn preserves_lifecycle_markers(
  input: Output,
  output: Output,
  mint: Value,
  policies: List<PolicyId>,
) -> Bool {
  list.all(
    policies,
    fn(policy) { preserves_lifecycle_marker(input, output, mint, policy) },
  )
}

fn mints_lifecycle_marker(mint: Value, policy: PolicyId) -> Bool {
  auth.mint_auth_token(
    mint,
    AuthToken { policy_id: policy, name: lifecycle_marker_token_name },
  )
}

/// Main validator for HostState STT
/// 
/// Enforces:
/// 1. Exactly one input with NFT (the old state)
/// 2. Exactly one output with NFT (the new state)
/// 3. NFT is preserved (not burned or duplicated)
/// 4. Version increments by 1
/// 5. State transition is valid for the operation
validator host_state_stt(
  nft_policy: PolicyId,
  _spend_client_script_hash: Hash<Blake2b_224, Script>,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  _client_minting_policy_id: PolicyId,
  _connection_minting_policy_id: PolicyId,
  _channel_minting_policy_id: PolicyId,
  lifecycle_creation_policy_id: PolicyId,
  lifecycle_reclamation_policy_id: PolicyId,
  lifecycle_operational_policy_id: PolicyId,
  lifecycle_packet_policy_id: PolicyId,
  reference_validator_script_hash: Hash<Blake2b_224, Script>,
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
      reference_inputs,
      outputs,
      mint,
      redeemers,
      extra_signatories,
      validity_range,
      ..
    } = transaction
    // 2. Find input HostState UTXO
    expect Some(host_input) = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    // 3. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy

    // 4. Validate state transition based on operation.
    when redeemer is {
      FinalizeShutdown -> False
      ReclaimHostState { reclaim_to } -> {
        expect address.Script(host_script_hash) =
          host_input.output.address.payment_credential
        expect [terminal_identity] =
          reference_script_identities_at_script(
            inputs,
            reference_validator_script_hash,
          )
        and {
          list.has(extra_signatories, old_datum.deployer),
          is_host_state_reclaimable_with_terminal_reference(
            old_datum,
            terminal_identity,
            validator_utils.get_tx_valid_from(validity_range),
            host_script_hash,
          ),
          auth.burn_auth_token(
            mint,
            AuthToken { policy_id: nft_policy, name: host_state_token_name },
          ),
          !list.any(
            outputs,
            fn(output) {
              assets.has_nft(output.value, nft_policy, host_state_token_name)
            },
          ),
          list.is_empty(
            transaction.find_script_outputs(
              outputs,
              reference_validator_script_hash,
            ),
          ),
          validator_utils.pays_exact_ada_only_reclamation_bounty(
            host_input.output,
            outputs,
            reclaim_to,
          ),
        }
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
        expect new_datum.nft_policy == nft_policy
        // The NFT policy and deployment authority are immutable for every
        // successor transition, so enforce them once at the coordinator edge.
        expect new_datum.deployer == old_datum.deployer
        let preserves_reference_inventory =
          when redeemer is {
            RegisterReferenceScripts { .. } |
            ReclaimReferenceScripts { .. } |
            FinalizeReferenceScriptRegistration -> True
            _ -> validate_reference_inventory_preserved(old_datum, new_datum)
          }

        and {
          preserves_reference_inventory,
          preserves_lifecycle_markers(
            host_input.output,
            host_output,
            mint,
            [
              lifecycle_creation_policy_id, lifecycle_reclamation_policy_id,
              lifecycle_operational_policy_id, lifecycle_packet_policy_id,
            ],
          ),
          when redeemer is {
            CreateClient { .. } -> and {
                validate_create_client(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_creation_policy_id),
              }
            CreateConnection { .. } -> and {
                validate_create_connection(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_creation_policy_id),
              }
            CreateChannel { .. } -> and {
                validate_create_channel(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_creation_policy_id),
              }
            BindPort { port_id, registration, .. } -> and {
                // A permanent global registration is an administrative action.
                // Requiring the deployment authority prevents port squatting and
                // makes the protocol-wide bound useful rather than attacker-fillable.
                list.has(extra_signatories, old_datum.deployer),
                validate_bind_port(old_datum, new_datum, port_id, registration),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            UpdateClient { .. } -> and {
                // Client updates should not change HostState sequencing, only the root.
                validate_update_client(
                  old_datum,
                  new_datum,
                  validator_utils.get_tx_valid_to(validity_range),
                ),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            UpdateConnection { .. } -> and {
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            UpdateChannel { .. } -> and {
                // Channel updates should not change HostState sequencing, only the root.
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_operational_policy_id),
              }
            HandlePacket { .. } -> and {
                // Packet operations should not change HostState sequencing, only the root.
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_packet_policy_id),
              }
            PruneTerminalClient { .. } -> and {
                validate_update_only_root(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            BeginConnectionRetirement -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_update_only_root(old_datum, new_datum),
                new_datum.state.ibc_state_root == old_datum.state.ibc_state_root,
                list.length(
                  inputs_at_script(inputs, spend_connection_script_hash),
                ) == 1,
                list.length(
                  transaction.find_script_outputs(
                    outputs,
                    spend_connection_script_hash,
                  ),
                ) == 1,
              }
            BeginChannelAbandonment -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_update_only_root(old_datum, new_datum),
                new_datum.state.ibc_state_root == old_datum.state.ibc_state_root,
                list.length(inputs_at_script(inputs, spend_channel_script_hash)) == 1,
                list.length(
                  transaction.find_script_outputs(
                    outputs,
                    spend_channel_script_hash,
                  ),
                ) == 1,
              }
            ReclaimChannel { .. } -> and {
                validate_reclaim_channel(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            ReclaimConnection { .. } -> and {
                validate_reclaim_connection(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            ReclaimClient { .. } -> and {
                validate_reclaim_client(old_datum, new_datum),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            EnterShutdown { grace_period_end } -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_enter_shutdown(
                  old_datum,
                  new_datum,
                  grace_period_end,
                  validator_utils.get_bounded_lifecycle_validity(validity_range).2nd,
                ),
              }
            SealShutdown -> {
              let (valid_from, valid_to) =
                validator_utils.get_bounded_lifecycle_validity(validity_range)
              and {
                list.has(extra_signatories, old_datum.deployer),
                validate_seal_shutdown(
                  old_datum,
                  new_datum,
                  valid_from,
                  valid_to,
                ),
              }
            }
            ReclaimModule { port_id } -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_reclaim_module(old_datum, new_datum, port_id),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            RegisterReferenceScripts {
              target_count,
              target_root,
              batch_out_refs,
            } -> {
              expect address.Script(host_script_hash) =
                host_input.output.address.payment_credential
              let inventory_reference_inputs =
                reference_script_inputs_at_script(
                  reference_inputs,
                  reference_validator_script_hash,
                )
              let batch_identities =
                selected_reference_script_identities_at_script(
                  reference_inputs,
                  reference_validator_script_hash,
                  batch_out_refs,
                )
              let has_host_reference_input =
                inventory_reference_inputs
                  |> list.any(
                      fn(input) {
                        input.output.reference_script == Some(host_script_hash)
                      },
                    )
              and {
                list.has(extra_signatories, old_datum.deployer),
                validate_register_reference_scripts(
                  old_datum,
                  new_datum,
                  batch_identities,
                  list.length(inventory_reference_inputs),
                  has_host_reference_input,
                  host_script_hash,
                  target_count,
                  target_root,
                ),
              }
            }
            ReclaimReferenceScripts { predecessor_root } -> {
              expect address.Script(host_script_hash) =
                host_input.output.address.payment_credential
              and {
                list.has(extra_signatories, old_datum.deployer),
                list.is_empty(
                  transaction.find_script_outputs(
                    outputs,
                    reference_validator_script_hash,
                  ),
                ),
                validate_reclaim_reference_scripts(
                  old_datum,
                  new_datum,
                  reference_script_identities_at_script(
                    inputs,
                    reference_validator_script_hash,
                  ),
                  predecessor_root,
                  validator_utils.get_tx_valid_from(validity_range),
                  host_script_hash,
                ),
              }
            }
            FinalizeReferenceScriptRegistration -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_finalize_reference_script_registration(
                  old_datum,
                  new_datum,
                ),
              }
            UpdateModuleState { port_id } -> and {
                validate_update_module_state(old_datum, new_datum),
                validate_module_operator(old_datum, port_id, inputs, redeemers),
              }
            Heartbeat -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_heartbeat(old_datum, new_datum),
              }
            _ -> fail
          },
        }
      }
    }
  }

  else(_) {
    fail @"HostState STT can only be spent"
  }
}
