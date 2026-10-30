use cardano/address.{Script}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/transaction
use ibc/utils/forwarding
use update_staged_client

const admin = #"11111111111111111111111111111111111111111111111111111111"

const ordinary = #"22222222222222222222222222222222222222222222222222222222"

test ordinary_credential_retires_alongside_pinned_administrative_credential() {
  let own = UnregisterCredential { credential: Script(ordinary), refund: Never }
  update_staged_client.update_staged_client.publish(
    #"",
    #"",
    admin,
    Void,
    own,
    transaction.Transaction {
      ..transaction.placeholder,
      certificates: [
        own,
        UnregisterCredential { credential: Script(admin), refund: Never },
      ],
    },
  )
}

test ordinary_credential_cannot_retire_alone() {
  let own = UnregisterCredential { credential: Script(ordinary), refund: Never }
  !update_staged_client.update_staged_client.publish(
    #"",
    #"",
    admin,
    Void,
    own,
    transaction.Transaction { ..transaction.placeholder, certificates: [own] },
  )
}

test ordinary_credential_rejects_retirement_with_another_script() {
  let own = UnregisterCredential { credential: Script(ordinary), refund: Never }
  !forwarding.deregister_with(
    admin,
    own,
    transaction.Transaction {
      ..transaction.placeholder,
      certificates: [
        own,
        UnregisterCredential {
          credential: Script(
            #"33333333333333333333333333333333333333333333333333333333",
          ),
          refund: Never,
        },
      ],
    },
  )
}

test ordinary_credential_does_not_accept_other_certificate_actions() fail {
  let registration =
    RegisterCredential { credential: Script(ordinary), deposit: Never }
  forwarding.deregister_with(
    admin,
    registration,
    transaction.Transaction {
      ..transaction.placeholder,
      certificates: [
        UnregisterCredential { credential: Script(admin), refund: Never },
      ],
    },
  )
}
