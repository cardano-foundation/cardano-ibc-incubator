use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/implementation/minting_client_stt as implementation

validator mint_client_stt(
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  host_state_nft_policy_id: PolicyId,
) {
  mint(
    redeemer: Data,
    client_mint_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      spend_client_script_hash,
      host_state_nft_policy_id,
      redeemer,
      client_mint_policy_id,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
