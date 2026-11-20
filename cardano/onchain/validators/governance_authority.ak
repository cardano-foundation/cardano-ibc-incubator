//// Adapted from CIP-113's withdrawal-authority pattern. The bridge registry
//// owns the flat M-of-N signer policy, proposal delay and signer rotation.
//// There is no separately mutable authority configuration or approval tree.
//// Reference: cardano-foundation/cip113-programmable-tokens at 369e8c280609.

use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential, Script}
use cardano/certificate.{Certificate, RegisterCredential, UnregisterCredential}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/migration/auth as migration
use ibc/migration/host_control
use ibc/migration/types.{Registry, registry_token_name}
use ibc/utils/shutdown
use ibc/utils/validator_utils

validator governance_authority(registry_policy: ByteArray) {
  withdraw(redeemer: Data, account: Credential, transaction: Transaction) {
    expect Script(own_hash) = account
    expect pairs.get_first(transaction.withdrawals, account) == Some(0)
    let token =
      AuthToken { policy_id: registry_policy, name: registry_token_name }
    let input =
      migration.unique_input(
        list.concat(transaction.inputs, transaction.reference_inputs),
        token,
      )
    expect registry: Registry = validator_utils.get_inline_datum(input.output)
    expect registry.token == token
    expect registry.approval_authority == own_hash
    if redeemer == builtin.constr_data(1, []) {
      host_control.validate(transaction, registry)
    } else {
      expect redeemer == builtin.constr_data(0, [])
      and {
        registry.token == token,
        registry.approval_authority == own_hash,
        migration.valid_governance(registry.governance),
        migration.authorized(registry.governance, transaction),
      }
    }
  }

  publish(_redeemer: Data, certificate: Certificate, transaction: Transaction) {
    when certificate is {
      RegisterCredential { .. } -> True
      UnregisterCredential { .. } -> {
        let input =
          migration.unique_input(
            transaction.reference_inputs,
            AuthToken { policy_id: registry_policy, name: registry_token_name },
          )
        expect registry: Registry =
          validator_utils.get_inline_datum(input.output)
        expect _ = shutdown.authority(transaction, registry.host_policy)
        True
      }
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
