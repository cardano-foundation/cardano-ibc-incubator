use cardano/address
use cardano/assets
use cardano/transaction.{NoDatum, Output}
use ibc/core/ics_002_client_semantics/registry.{ClientRegistration, Tendermint}

fn registration(client_type: ByteArray, policy: ByteArray) -> ClientRegistration {
  ClientRegistration {
    client_type,
    implementation: Tendermint,
    mint_policy: policy,
    spend_validator: policy,
    proof_policy: policy,
  }
}

test routes_registered_types_independently_of_their_sequence() {
  let a = registration("07-tendermint", "policy-a")
  let b = registration("07-tendermint-v2", "policy-b")
  let registrations: Data = [a, b]
  and {
    registry.for_client(registrations, "07-tendermint-42") == a,
    registry.for_client(registrations, "07-tendermint-v2-42") == b,
    registry.identifier(b, "43") == "07-tendermint-v2-43",
    registry.sequence(b, "07-tendermint-v2-43") == "43",
  }
}

test rejects_an_unregistered_type() fail {
  let registrations: Data = [registration("07-tendermint", "policy-a")]
  expect _ = registry.for_client(registrations, "08-wasm-0")
}

test rejects_ambiguous_registration() fail {
  let registrations: Data =
    [
      registration("07-tendermint", "policy-a"),
      registration("07-tendermint", "policy-b"),
    ]
  expect _ = registry.for_client(registrations, "07-tendermint-0")
}

test rejects_a_prefix_match_without_a_numeric_sequence() fail {
  let registrations: Data = [registration("07-tendermint", "policy-a")]
  expect _ = registry.for_client(registrations, "07-tendermint-v2-0")
}

test resolves_only_a_registered_spending_script() {
  let a = registration("07-tendermint", "policy-a")
  let b = registration("07-tendermint-v2", "policy-b")
  let registrations: Data = [a, b]
  let output =
    Output {
      address: address.from_script("policy-b"),
      value: assets.zero,
      datum: NoDatum,
      reference_script: None,
    }
  registry.for_output(registrations, "unused legacy policy", output) == b
}
