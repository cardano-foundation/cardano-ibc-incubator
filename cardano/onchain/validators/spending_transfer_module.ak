use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/ibc_module_redeemer.{IBCModuleRedeemer}
use ibc/implementation/spending_transfer_module as implementation

validator spend_transfer_module(
  port_token: AuthToken,
  module_token: AuthToken,
  port_id: ByteArray,
  transfer_escrow_shard_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
  voucher_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  shutdown_script_hash: ByteArray,
) {
  spend(
    datum: Option<Data>,
    redeemer: IBCModuleRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      port_token,
      module_token,
      port_id,
      transfer_escrow_shard_policy_id,
      channel_minting_policy_id,
      voucher_minting_policy_id,
      host_state_nft_policy_id,
      shutdown_script_hash,
      datum,
      redeemer,
      spent_output_ref,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
