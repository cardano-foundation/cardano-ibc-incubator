use aiken/collection/list
use aiken/collection/pairs
use cardano/assets
use cardano/transaction.{Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state as host
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  AuthorizeFinalization, BindPort, EnterShutdown, FinalizeShutdown,
  HostStateRedeemer, RetireState,
}
use ibc/implementation/host_state_stt
use ibc/migration/auth as migration
use ibc/migration/types.{Ready, Registry, host_role, transfer_role}
use ibc/utils/validator_utils

pub fn validate(transaction: Transaction, registry: Registry) -> Bool {
  expect registry.phase == Ready
  let input =
    migration.unique_input(
      transaction.inputs,
      AuthToken {
        policy_id: registry.host_policy,
        name: host.host_state_token_name,
      },
    )
  expect
    input.output.address == migration.role_address(registry.current, host_role)
  expect old: host.HostStateDatum =
    validator_utils.get_inline_datum(input.output)
  expect old.nft_policy == registry.host_policy
  expect Some(raw) =
    pairs.get_first(transaction.redeemers, Spend(input.output_reference))
  expect redeemer: HostStateRedeemer = raw
  if redeemer == FinalizeShutdown {
    and {
      list.has(transaction.extra_signatories, old.deployer),
      host.validate_finalize_shutdown(
        old,
        validator_utils.get_tx_valid_from(transaction.validity_range),
      ),
      assets.quantity_of(
        transaction.mint,
        registry.host_policy,
        host.host_state_token_name,
      ) == -1,
    }
  } else {
    let output =
      migration.unique_output(
        transaction.outputs,
        AuthToken {
          policy_id: registry.host_policy,
          name: host.host_state_token_name,
        },
      )
    expect output.address == input.output.address
    expect
      validator_utils.preserves_state_value(input.output.value, output.value)
    expect new: host.HostStateDatum = validator_utils.get_inline_datum(output)
    when redeemer is {
      BindPort { port_id, registration, port_siblings } -> {
        expect migration.permitted(registry.emergency.mask, 1)
        let module_output =
          host_state_stt.find_state_output(
            transaction.outputs,
            registration.module_script_hash,
          )
        expect
          port_id != "transfer" || module_output.address == migration.role_address(
            registry.current,
            transfer_role,
          )
        and {
          list.has(transaction.extra_signatories, old.deployer),
          host.validate_bind_port(old, new, port_id, registration),
          host_state_stt.validate_bind_port_root(
            old,
            new,
            port_id,
            registration,
            module_output,
            port_siblings,
          ),
        }
      }
      EnterShutdown { grace_period_end } -> {
        let valid_to =
          validator_utils.get_tx_valid_to(transaction.validity_range)
        and {
          migration.authorized(registry.governance, transaction),
          list.has(transaction.extra_signatories, old.deployer),
          grace_period_end >= valid_to + registry.governance.delay_ms,
          host.validate_enter_shutdown(old, new, grace_period_end, valid_to),
        }
      }
      AuthorizeFinalization ->
        host_state_stt.validate_transfer_finalization_authorization(
          old,
          new,
          transaction.inputs,
          transaction.mint,
          validator_utils.get_tx_valid_from(transaction.validity_range),
        )
      RetireState { kind, token_name } -> {
        let policy =
          when kind is {
            0 -> registry.identity.client_policy
            1 -> registry.identity.connection_policy
            2 -> registry.identity.channel_policy
            _ -> fail
          }
        and {
          host.validate_shutdown_authority(
            old,
            validator_utils.get_tx_valid_from(transaction.validity_range),
          ),
          list.has(transaction.extra_signatories, old.deployer),
          host.validate_retire_state(old, new, kind),
          validator_utils.require_exact_marker_mint(
            transaction.mint,
            policy,
            token_name,
            -1,
          ),
        }
      }
      _ -> False
    }
  }
}
