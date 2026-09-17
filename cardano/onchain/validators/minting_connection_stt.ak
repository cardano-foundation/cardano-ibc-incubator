use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/implementation/minting_connection_stt as implementation

validator mint_connection_stt(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
) {
  mint(
    redeemer: Data,
    connection_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      client_minting_policy_id,
      verify_proof_policy_id,
      spend_connection_script_hash,
      host_state_nft_policy_id,
      redeemer,
      connection_minting_policy_id,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
