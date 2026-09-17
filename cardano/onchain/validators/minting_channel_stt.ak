use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/implementation/minting_channel_stt as implementation

validator mint_channel_stt(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
  shutdown_script_hash: ByteArray,
) {
  mint(
    redeemer: Data,
    channel_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      client_minting_policy_id,
      connection_minting_policy_id,
      port_minting_policy_id,
      verify_proof_policy_id,
      spend_channel_script_hash,
      host_state_nft_policy_id,
      shutdown_script_hash,
      redeemer,
      channel_minting_policy_id,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
