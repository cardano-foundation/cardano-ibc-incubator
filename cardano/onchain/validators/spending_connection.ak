use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/connection_redeemer.{
  SpendConnectionRedeemer,
}
use ibc/implementation/spending_connection as implementation

validator spend_connection(
  client_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  spend(
    datum: Option<ConnectionDatum>,
    redeemer: SpendConnectionRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      client_minting_policy_id,
      verify_proof_policy_id,
      host_state_nft_policy_id,
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
