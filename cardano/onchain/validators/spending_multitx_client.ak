use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/multitx/client_redeemer.{
  SpendMultitxClientRedeemer,
}
use ibc/implementation/spending_multitx_client as implementation

validator spend_multitx_client(
  host_state_nft_policy_id: PolicyId,
  session_mint_policy_id: PolicyId,
  recover_client_credential: Credential,
) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendMultitxClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      host_state_nft_policy_id,
      session_mint_policy_id,
      recover_client_credential,
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
