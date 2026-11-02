use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential, Script}
use cardano/certificate.{Certificate}
use cardano/transaction.{Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/utils/forwarding

/// The client and cache guards pin this entry point. It selects a pinned core
/// from the actual client spending witness without decoding that witness twice.
validator update_cached_client(
  update_script: ByteArray,
  general_update_script: ByteArray,
  administrative_script: ByteArray,
) {
  withdraw(subject: AuthToken, credential: Credential, tx: Transaction) {
    let expected: Data = subject
    expect forwarding.require_zero(credential, expected, tx)
    expect [client] =
      list.filter(
        tx.inputs,
        fn(input) { auth.contain_auth_token(input.output, subject) },
      )
    expect Some(raw) =
      pairs.get_first(tx.redeemers, Spend(client.output_reference))
    expect Pair(6, [payload]) = builtin.un_constr_data(raw)
    expect Pair(0, [_,
      _, _, _, _, _, _, sets, _]) = builtin.un_constr_data(payload)
    let full =
      when builtin.un_list_data(sets) is {
        [set] -> builtin.un_constr_data(set).1st == 0
        _ -> False
      }
    let selected =
      if full {
        general_update_script
      } else {
        update_script
      }
    forwarding.require_zero(Script(selected), expected, tx)
  }

  publish(_redeemer: Void, certificate: Certificate, tx: Transaction) {
    forwarding.deregister_with(administrative_script, certificate, tx)
  }

  else(_) {
    fail
  }
}
