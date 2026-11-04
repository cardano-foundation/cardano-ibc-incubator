use cardano/address.{Credential}
use cardano/certificate.{Certificate}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/roster_update
use ibc/utils/forwarding

validator verify_roster_client(
  host_policy: ByteArray,
  administrative_script: ByteArray,
) {
  withdraw(subject: AuthToken, credential: Credential, tx: Transaction) {
    roster_update.validate(host_policy, subject, credential, tx)
  }

  publish(_redeemer: Void, certificate: Certificate, tx: Transaction) {
    forwarding.deregister_with(administrative_script, certificate, tx)
  }

  else(_) {
    fail
  }
}
