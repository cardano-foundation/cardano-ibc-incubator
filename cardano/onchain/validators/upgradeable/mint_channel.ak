use cardano/transaction.{Transaction}
use ibc/core/ics_002_client_semantics/registry as clients
use ibc/implementation/minting_channel_stt
use ibc/migration/auth as migration
use ibc/utils/shutdown

validator mint_channel(
  registry_policy: ByteArray,
  port_policy: ByteArray,
  proof_policy: ByteArray,
  shutdown_hash: ByteArray,
) {
  mint(redeemer: Data, policy: ByteArray, transaction: Transaction) {
    let (host_policy, client_policy, connection_policy, address, client_address) =
      migration.channel_creation_context(transaction, registry_policy)
    if shutdown.burns_only(transaction.mint, policy) {
      minting_channel_stt.validate_retire(
        migration.encoded_address_hash(address),
        host_policy,
        shutdown_hash,
        policy,
        transaction,
      )
    } else {
      expect migration.exact_creation_address(transaction, address)
      let registrations: Data =
        [
          clients.tendermint_registration(
            client_policy,
            migration.encoded_address_hash(client_address),
            proof_policy,
          ),
        ]
      minting_channel_stt.validate_create(
        registrations,
        connection_policy,
        port_policy,
        proof_policy,
        migration.encoded_address_hash(address),
        host_policy,
        shutdown_hash,
        redeemer,
        policy,
        transaction,
      )
    }
  }

  else(_) {
    fail
  }
}
