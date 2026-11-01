use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use cardano/assets.{PolicyId}
use cardano/transaction.{Output, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum}
use ibc/core/ics_002_client_semantics/types/keys.{client_prefix}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  CreateClient, HostStateRedeemer,
}
use ibc/utils/text_bytes
use ibc/utils/validator_utils

pub fn token_name(subject: AuthToken) -> ByteArray {
  // Reconstruct the constructor so input CBOR choices cannot create aliases.
  crypto.sha3_256(
    cbor.serialise(
      AuthToken { policy_id: subject.policy_id, name: subject.name },
    ),
  )
}

pub fn preserves(before: CacheDatum, after: CacheDatum) -> Bool {
  before.token == after.token && before.client_token == after.client_token && before.client_address == after.client_address
}

/// HostState's CreateClient validates the registered client policy and address.
/// Selecting its unique canonical name across *all* policies binds this exact
/// output to that operation. A second token using the name cannot shadow it.
pub fn admitted_client(
  host_policy: PolicyId,
  subject: AuthToken,
  tx: Transaction,
) -> Output {
  expect [host_input] =
    list.filter(
      tx.inputs,
      fn(input) {
        assets.has_nft(input.output.value, host_policy, host_state_token_name)
      },
    )
  expect host: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  expect host.nft_policy == host_policy
  expect Some(raw) =
    pairs.get_first(tx.redeemers, Spend(host_input.output_reference))
  expect CreateClient { .. }: HostStateRedeemer = raw
  let expected_name =
    auth.generate_token_name(
      AuthToken { policy_id: host_policy, name: host_state_token_name },
      client_prefix,
      text_bytes.int_to_decimal_bytes(host.state.next_client_sequence),
    )
  expect subject.name == expected_name
  expect [output] =
    list.filter(
      tx.outputs,
      fn(output) {
        list.any(
          assets.flatten(output.value),
          fn(asset) { asset.2nd == expected_name && asset.3rd != 0 },
        )
      },
    )
  expect auth.contain_auth_token(output, subject)
  expect auth.contains_only_auth_tokens(output, [subject])
  output
}
