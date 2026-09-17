use aiken/builtin
use aiken/fuzz
use aiken/primitive/bytearray
use cardano/address
use cardano/assets
use cardano/transaction.{NoDatum, Output}
use ibc/core/ics_002_client_semantics/registry.{ClientRegistration, Tendermint}
use ibc/core/ics_002_client_semantics/types/keys
use ibc/testing/client_registry_fixtures

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

test prop_client_registry_routes_exact_identifiers(
  sample via registered_client_cases(),
) {
  fuzz.label(@"fuzz.unit.client.registry.valid_identity")
  let registrations: Data = client_registry_fixtures.registrations(sample)
  let first_id = registry.identifier(sample.first, sample.sequence)
  let second_id = registry.identifier(sample.second, sample.sequence)
  and {
    registry.for_client(registrations, first_id) == sample.first,
    registry.for_client(registrations, second_id) == sample.second,
    registry.sequence(sample.first, first_id) == sample.sequence,
    registry.sequence(sample.second, second_id) == sample.sequence,
    keys.parse_client_id_sequence(first_id) == sample.sequence,
    keys.parse_client_id_sequence(second_id) == sample.sequence,
    !registry.matches_id(sample.first, second_id),
    !registry.matches_id(sample.second, first_id),
  }
}

test prop_client_registry_rejects_unknown_type(
  sample via registered_client_cases(),
) fail {
  // Keep the coverage label on the argument that is forced before rejection.
  let registrations: Data =
    builtin.debug(
      @"\0fuzz.unit.client.registry.invalid_unknown_type",
      client_registry_fixtures.registrations(sample),
    )
  let unknown =
    ClientRegistration {
      ..sample.first,
      client_type: bytearray.concat(sample.first.client_type, "-unknown"),
    }
  expect _ =
    registry.for_client(
      registrations,
      registry.identifier(unknown, sample.sequence),
    )
}

test prop_client_registry_rejects_duplicate_type(
  sample via registered_client_cases(),
) fail {
  let duplicate =
    ClientRegistration {
      ..sample.second,
      client_type: sample.first.client_type,
    }
  let registrations: Data =
    builtin.debug(
      @"\0fuzz.unit.client.registry.invalid_duplicate_type",
      [sample.first, duplicate],
    )
  expect _ =
    registry.for_client(
      registrations,
      registry.identifier(sample.first, sample.sequence),
    )
}

test prop_client_registry_rejects_noncanonical_sequence(
  sample via registered_client_cases(),
) fail {
  fuzz.label(@"fuzz.unit.client.registry.invalid_sequence")
  let registrations: Data = client_registry_fixtures.registrations(sample)
  let sequence =
    if sample.reverse {
      bytearray.concat("0", sample.sequence)
    } else {
      bytearray.concat(sample.sequence, "x")
    }
  expect _ =
    registry.for_client(
      registrations,
      registry.identifier(sample.first, sequence),
    )
}

test prop_client_registry_routes_output_by_script(
  sample via registered_client_cases(),
) {
  fuzz.label(@"fuzz.unit.client.registry.valid_output")
  let registrations: Data = client_registry_fixtures.registrations(sample)
  let output =
    Output {
      address: address.from_script(sample.second.spend_validator),
      value: assets.zero,
      datum: NoDatum,
      reference_script: None,
    }
  registry.is_client_output(registrations, output) && registry.for_output(
    registrations,
    sample.first.mint_policy,
    output,
  ) == sample.second
}

test prop_client_registry_rejects_uncompiled_implementation(
  sample via registered_client_cases(),
) fail {
  fuzz.label(@"fuzz.unit.client.registry.invalid_implementation")
  let unknown =
    builtin.constr_data(
      0,
      [
        builtin.b_data(sample.first.client_type),
        builtin.constr_data(1, []),
        builtin.b_data(sample.first.mint_policy),
        builtin.b_data(sample.first.spend_validator),
        builtin.b_data(sample.first.proof_policy),
      ],
    )
  let registrations: Data = [unknown]
  expect _ =
    registry.for_client(
      registrations,
      registry.identifier(sample.first, sample.sequence),
    )
}

fn registered_client_cases() -> Fuzzer<client_registry_fixtures.RegistryCase> {
  let suffix <- fuzz.and_then(fuzz.int_between(0, 65535))
  let sequence <- fuzz.and_then(fuzz.int_between(0, 18446744073709551615))
  let seed <- fuzz.and_then(fuzz.bytearray())
  let reverse <- fuzz.and_then(fuzz.bool())
  let reverse_references <- fuzz.map(fuzz.bool())
  client_registry_fixtures.registry_case(
    suffix,
    sequence,
    seed,
    reverse,
    reverse_references,
  )
}
