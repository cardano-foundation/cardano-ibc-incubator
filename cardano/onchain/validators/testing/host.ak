//// Unit fixture for the governed HostState and its fixed control authority.
//// The registry is seeded here. Registry mint/custody is exercised separately.

use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Address, Script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction, Withdraw,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_002_client_semantics/registry.{ClientRegistration}
use ibc/core/ics_025_handler_interface/heartbeat.{HeartbeatSchedule}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  FinalizeShutdown, HostStateRedeemer,
}
use ibc/migration/auth as migration
use ibc/migration/types.{
  Authority, Emergency, FixedIdentity, Governance, Implementation, Ready,
  Registry, registry_token_name,
}

pub fn context(
  host_policy: ByteArray,
  clients: Data,
  connection: ByteArray,
  channel: ByteArray,
  client_policy: ByteArray,
  connection_policy: ByteArray,
  channel_policy: ByteArray,
  _schedule: HeartbeatSchedule,
  _datum: Option<HostStateDatum>,
  redeemer: HostStateRedeemer,
  own_ref: OutputReference,
  transaction: Transaction,
) -> (Registry, Transaction) {
  let registry_policy =
    #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  let authority = #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  let host_input =
    migration.unique_input(
      transaction.inputs,
      AuthToken { policy_id: host_policy, name: host_state_token_name },
    )
  expect InlineDatum(raw) = host_input.output.datum
  expect old: HostStateDatum = raw
  let client =
    if clients is hash: ByteArray {
      hash
    } else {
      expect registrations: List<ClientRegistration> = clients
      let registration =
        list.expect_find(
          registrations,
          fn(r) { r.mint_policy == client_policy },
        )
      registration.spend_validator
    }
  let transfer =
    when pairs.get_first(old.control.port_registry, "transfer") is {
      Some(registration) -> registration.module_script_hash
      None -> authority
    }
  let address =
    fn(hash) {
      Address { payment_credential: Script(hash), stake_credential: None }
    }
  let registry =
    Registry {
      token: AuthToken { policy_id: registry_policy, name: registry_token_name },
      host_policy,
      identity: FixedIdentity {
        client_policy,
        connection_policy,
        channel_policy,
        escrow_policy: authority,
        reference_holder: address(authority),
      },
      governance: Governance {
        signers: [old.deployer],
        quorum: 1,
        delay_ms: 86_400_000,
      },
      nonce: 0,
      current: Implementation {
        generation: 1,
        addresses: [
          host_input.output.address,
          address(client),
          address(connection),
          address(channel),
          address(transfer),
        ],
        compatibility: #"",
      },
      phase: Ready,
      emergency: Emergency {
        authority: Authority { signers: [authority], quorum: 1 },
        epoch: 0,
        mask: 0,
        restoration: None,
      },
      approval_authority: authority,
    }
  let reference =
    Input {
      output_reference: OutputReference {
        transaction_id: #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        output_index: 0,
      },
      output: Output {
        address: address(registry_policy),
        value: assets.from_asset(registry_policy, registry_token_name, 1),
        datum: InlineDatum(registry),
        reference_script: None,
      },
    }
  let raw_redeemer: Data = redeemer
  let control =
    migration.is_host_control(raw_redeemer) && redeemer != FinalizeShutdown
  let tx =
    Transaction {
      ..transaction,
      reference_inputs: [reference, ..transaction.reference_inputs],
      withdrawals: if control {
        [Pair(Script(authority), 0), ..transaction.withdrawals]
      } else {
        transaction.withdrawals
      },
      redeemers: [
        Pair(Spend(own_ref), raw_redeemer),
        ..if control {
          [
            Pair(Withdraw(Script(authority)), builtin.constr_data(1, [])),
            ..transaction.redeemers
          ]
        } else {
          transaction.redeemers
        }
      ],
    }
  (registry, tx)
}
