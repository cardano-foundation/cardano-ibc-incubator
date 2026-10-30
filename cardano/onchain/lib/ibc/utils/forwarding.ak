use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential, Script}
use cardano/certificate.{Certificate, UnregisterCredential}
use cardano/transaction.{Transaction, Withdraw}

/// Bind a guard to one execution of a pinned script and its exact redeemer.
pub fn require_zero(
  credential: Credential,
  redeemer: Data,
  transaction: Transaction,
) -> Bool {
  expect Script(_) = credential
  and {
    pairs.get_all(transaction.withdrawals, credential) == [0],
    pairs.get_all(transaction.redeemers, Withdraw(credential)) == [redeemer],
  }
}

/// The administrative script already authenticates shutdown. Retire forwarded
/// credentials in the same transaction as that pinned script's deregistration
/// so ordinary scripts need not carry another copy of shutdown authorization.
pub fn deregister_with(
  administrative_script: ByteArray,
  certificate: Certificate,
  transaction: Transaction,
) -> Bool {
  expect UnregisterCredential { .. } = certificate
  list.any(
    transaction.certificates,
    fn(cert) {
      when cert is {
        UnregisterCredential { credential, .. } ->
          credential == Script(administrative_script)
        _ -> False
      }
    },
  )
}
