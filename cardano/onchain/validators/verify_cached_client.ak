use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/update
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/utils/forwarding

validator verify_cached_client(
  host_policy: PolicyId,
  administrative_script: ByteArray,
) {
  withdraw(subject: AuthToken, credential: Credential, tx: Transaction) {
    update.validate(host_policy, subject, credential, tx, verify.header)
  }

  publish(_redeemer: Void, certificate: Certificate, tx: Transaction) {
    forwarding.deregister_with(administrative_script, certificate, tx)
  }

  else(_) {
    fail
  }
}
