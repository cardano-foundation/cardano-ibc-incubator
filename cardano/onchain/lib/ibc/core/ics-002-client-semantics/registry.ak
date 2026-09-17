use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Output}
use ibc/client/ics_007_tendermint_client/adapter as tendermint
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/client_view.{ClientView}
use ibc/utils/string

/// Implementations are explicitly compiled into the adapter dispatcher. A
/// relayer cannot register executable code or choose its own verification rules.
pub type Implementation {
  Tendermint
}

/// Immutable validator parameters, shared by HostState and IBC consumers.
/// Registering another implementation requires a new deployment of the suite.
pub type ClientRegistration {
  client_type: ByteArray,
  implementation: Implementation,
  mint_policy: PolicyId,
  spend_validator: ByteArray,
  proof_policy: PolicyId,
}

/// Byte parameters retain the original Tendermint deployment ABI. New
/// deployments pass List<ClientRegistration> instead. These are script
/// parameters, never transaction-supplied registrations.
pub fn for_client(registry: Data, client_id: ByteArray) -> ClientRegistration {
  if registry is policy: ByteArray {
    let registration = legacy(policy, "", "")
    expect matches_id(registration, client_id)
    registration
  } else {
    expect registrations: List<ClientRegistration> = registry
    expect [registration] =
      list.filter(
        registrations,
        fn(registration) { matches_id(registration, client_id) },
      )
    registration
  }
}

pub fn matches_id(
  registration: ClientRegistration,
  client_id: ByteArray,
) -> Bool {
  let prefix = bytearray.concat(registration.client_type, "-")
  let length = bytearray.length(prefix)
  and {
    bytearray.take(client_id, length) == prefix,
    string.is_uint_string(bytearray.drop(client_id, length)),
  }
}

pub fn identifier(
  registration: ClientRegistration,
  sequence: ByteArray,
) -> ByteArray {
  registration.client_type
    |> bytearray.concat("-")
    |> bytearray.concat(sequence)
}

pub fn sequence(
  registration: ClientRegistration,
  client_id: ByteArray,
) -> ByteArray {
  expect matches_id(registration, client_id)
  bytearray.drop(client_id, bytearray.length(registration.client_type) + 1)
}

pub fn legacy(
  mint_policy: PolicyId,
  spend_validator: ByteArray,
  proof_policy: PolicyId,
) -> ClientRegistration {
  ClientRegistration {
    client_type: tendermint.client_type,
    implementation: Tendermint,
    mint_policy,
    spend_validator,
    proof_policy,
  }
}

pub fn for_output(
  registry: Data,
  fallback_policy: PolicyId,
  output: Output,
) -> ClientRegistration {
  expect Script(script_hash) = output.address.payment_credential
  if registry is script: ByteArray {
    expect script_hash == script
    legacy(fallback_policy, script, "")
  } else {
    expect registrations: List<ClientRegistration> = registry
    expect [registration] =
      list.filter(
        registrations,
        fn(registration) { registration.spend_validator == script_hash },
      )
    registration
  }
}

pub fn is_client_output(registry: Data, output: Output) -> Bool {
  when output.address.payment_credential is {
    Script(script_hash) ->
      if registry is script: ByteArray {
        script_hash == script
      } else {
        expect registrations: List<ClientRegistration> = registry
        list.any(
          registrations,
          fn(registration) { registration.spend_validator == script_hash },
        )
      }
    _ -> False
  }
}

pub fn view(
  registration: ClientRegistration,
  datum: Data,
  current_time: Int,
  proof_height: Option<Height>,
  witness: Option<Data>,
) -> ClientView {
  let Tendermint = registration.implementation
  tendermint.view(datum, current_time, proof_height, witness)
}

pub fn commitment_view(
  registration: ClientRegistration,
  datum: Data,
) -> ClientView {
  let Tendermint = registration.implementation
  tendermint.commitment_view(datum)
}
