use cardano/address.{Credential}
use cardano/transaction.{Transaction}
use ibc/client/ics_007_tendermint_client/proof_update/gnark_wrapper.{
  VerificationKey,
}
use ibc/client/ics_007_tendermint_client/proof_update/state.{
  ProofUpdateRedeemer,
}
use ibc/client/ics_007_tendermint_client/proof_update/state as proof_update_state

const released_update_client_program_vkey =
  #"00d38536f65ab10e7eff0895b1b9f7cf12f89691631742bb487fe090027e0e6d"

const released_misbehaviour_program_vkey =
  #"0010008da4267c2e85d02616e853379e3c937c03a271b5b005f479cff09ccfcb"

validator verify_tendermint_update(wrapper_vk: VerificationKey) {
  withdraw(
    redeemer: ProofUpdateRedeemer,
    _credential: Credential,
    transaction: Transaction,
  ) {
    proof_update_state.verify_transaction(
      redeemer,
      transaction,
      released_update_client_program_vkey,
      released_misbehaviour_program_vkey,
      wrapper_vk,
    )
  }

  else(_) {
    fail
  }
}
