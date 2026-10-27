//// Adapted from CIP-113's withdrawal-authority pattern. The bridge registry
//// owns the flat M-of-N signer policy, proposal delay and signer rotation.
//// There is no separately mutable authority configuration or approval tree.
//// Reference: cardano-foundation/cip113-programmable-tokens at 369e8c280609.

use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential, Script}
use cardano/certificate.{Certificate, RegisterCredential}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/migration/auth as migration
use ibc/migration/types.{Registry, registry_token_name}
use ibc/utils/validator_utils

validator governance_authority(registry_policy: ByteArray) {
  withdraw(_redeemer: Data, account: Credential, transaction: Transaction) {
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
    and {
      registry.token == token,
      registry.approval_authority == own_hash,
      migration.valid_governance(registry.governance),
      migration.authorized(registry.governance, transaction),
    }
  }

  publish(_redeemer: Data, certificate: Certificate, _transaction: Transaction) {
    when certificate is {
      RegisterCredential { .. } -> True
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
