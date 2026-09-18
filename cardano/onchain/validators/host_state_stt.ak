use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/host_state.{HostStateDatum}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{HostStateRedeemer}
use ibc/implementation/host_state_stt as implementation

validator host_state_stt(
  nft_policy: PolicyId,
  spend_client_script_hash: Hash<Blake2b_224, Script>,
  spend_connection_script_hash: Hash<Blake2b_224, Script>,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  client_policy_id: PolicyId,
  connection_policy_id: PolicyId,
  channel_policy_id: PolicyId,
) {
  spend(
    _datum_opt: Option<HostStateDatum>,
    redeemer: HostStateRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    implementation.validate(
      True,
      nft_policy,
      spend_client_script_hash,
      spend_connection_script_hash,
      spend_channel_script_hash,
      client_policy_id,
      connection_policy_id,
      channel_policy_id,
      None,
      redeemer,
      spent_output_ref,
      transaction,
    )
  }

  else(_) {
    fail
  }
}
