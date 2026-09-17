use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/migration/auth as migration
use ibc/migration/types.{Governance, Ready, Registry, registry_token_name}
use ibc/utils/validator_utils

// Governance and address are explicit deployment parameters. No fallback key.
// This immutable one-shot policy never permits burning the registry identity.
validator mint_implementation_registry(
  nonce: OutputReference,
  registry_address: Address,
  host_policy: ByteArray,
  governance: Governance,
) {
  mint(_redeemer: Data, policy: ByteArray, transaction: Transaction) {
    expect migration.valid_governance(governance)
    expect migration.authorized(governance, transaction)
    expect
      list.any(
        transaction.inputs,
        fn(input) { input.output_reference == nonce },
      )
    expect
      assets.tokens(transaction.mint, policy) == dict.singleton(
        registry_token_name,
        1,
      )
    let token = AuthToken { policy_id: policy, name: registry_token_name }
    let output = migration.unique_output(transaction.outputs, token)
    expect output.address == registry_address
    expect registry: Registry = validator_utils.get_inline_datum(output)
    let policies =
      [
        registry.identity.client_policy,
        registry.identity.connection_policy,
        registry.identity.channel_policy,
        registry.identity.escrow_policy,
        host_policy,
        policy,
      ]
    expect list.length(list.unique(policies)) == 6
    expect list.all(policies, fn(hash) { bytearray.length(hash) == 28 })
    expect Script(holder_hash) =
      registry.identity.reference_holder.payment_credential
    expect bytearray.length(holder_hash) == 28
    expect !list.has(registry.current.addresses, registry_address)
    and {
      registry.token == token,
      registry.host_policy == host_policy,
      registry.governance == governance,
      registry.nonce == 0,
      registry.current.generation == 1,
      migration.valid_implementation(registry.current),
      registry.phase == Ready,
    }
  }

  else(_) {
    fail
  }
}
