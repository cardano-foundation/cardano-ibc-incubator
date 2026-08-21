// HostState is the single coordinator UTxO for IBC object creation and root updates.

use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/address as address
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer, Operator}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ModuleRegistration, host_state_token_name,
  is_host_state_reclaimable, validate_bind_port, validate_create_channel,
  validate_create_client, validate_create_connection, validate_enter_shutdown,
  validate_heartbeat, validate_reclaim_channel, validate_reclaim_client,
  validate_reclaim_connection, validate_reclaim_module, validate_seal_shutdown,
  validate_update_module_state, validate_update_only_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  BeginChannelAbandonment, BeginConnectionRetirement, BindPort, CreateChannel,
  CreateClient, CreateConnection, EnterShutdown, FinalizeShutdown, HandlePacket,
  Heartbeat, HostStateRedeemer, PruneTerminalClient, ReclaimChannel,
  ReclaimClient, ReclaimConnection, ReclaimHostState, ReclaimModule,
  SealShutdown, UpdateChannel, UpdateClient, UpdateConnection, UpdateModuleState,
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
    expect Some(host_input) = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    // 3. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy

    // 4. Validate state transition based on operation.
    when redeemer is {
      FinalizeShutdown -> False
      ReclaimHostState { reclaim_to } -> and {
          list.has(extra_signatories, old_datum.deployer),
          is_host_state_reclaimable(
            old_datum,
            validator_utils.get_tx_valid_from(validity_range),
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
          validator_utils.pays_exact_ada_only_reclamation_bounty(
            host_input.output,
            outputs,
            reclaim_to,
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
        expect new_datum.nft_policy == nft_policy

        and {
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_creation_policy_id,
          ),
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_reclamation_policy_id,
          ),
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_operational_policy_id,
          ),
          preserves_lifecycle_marker(
            host_input.output,
            host_output,
            mint,
            lifecycle_packet_policy_id,
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
                validate_update_only_root(old_datum, new_datum),
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
                validate_enter_shutdown(old_datum, new_datum, grace_period_end),
              }
            SealShutdown -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_seal_shutdown(
                  old_datum,
                  new_datum,
                  validator_utils.get_tx_valid_from(validity_range),
                ),
              }
            ReclaimModule { port_id } -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_reclaim_module(old_datum, new_datum, port_id),
                mints_lifecycle_marker(mint, lifecycle_reclamation_policy_id),
              }
            UpdateModuleState { port_id } -> and {
                validate_update_module_state(old_datum, new_datum),
                validate_module_operator(old_datum, port_id, inputs, redeemers),
              }
            Heartbeat -> and {
                list.has(extra_signatories, old_datum.deployer),
                validate_heartbeat(old_datum, new_datum),
              }
            FinalizeShutdown | ReclaimHostState { .. } -> fail
          },
        }
      }
    }
  }

  else(_) {
    fail @"HostState STT can only be spent"
  }
}
