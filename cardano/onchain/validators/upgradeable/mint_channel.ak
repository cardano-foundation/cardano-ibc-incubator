use cardano/transaction.{Transaction}
use ibc/implementation/minting_channel_stt
use ibc/migration/auth as migration

validator mint_channel(
  registry_policy: ByteArray,
  port_policy: ByteArray,
  proof_policy: ByteArray,
  shutdown_hash: ByteArray,
) {
  mint(redeemer: Data, policy: ByteArray, transaction: Transaction) {
    let (host_policy, client_policy, connection_policy, address) =
      migration.channel_creation_context(transaction, registry_policy)
    expect migration.exact_creation_address(transaction, address)
    // validate_create requires the exact singleton positive authentication mint;
    // there is no retirement/burn branch in this entry point.
    minting_channel_stt.validate_create(
      client_policy,
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

  else(_) {
    fail
  }
}
