use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Output, Transaction}
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

pub type BridgeDeployment {
  host_state_nft_policy_id: PolicyId,
  channel_minting_policy_id: PolicyId,
}

pub type BridgeRegistryDatum {
  active_deployment: BridgeDeployment,
  active_voucher_policy_id: PolicyId,
  legacy_voucher_policy_ids: List<PolicyId>,
  governance_key_hash: VerificationKeyHash,
}

pub fn find_registry_datum(
  transaction: Transaction,
  registry_token: AuthToken,
) -> BridgeRegistryDatum {
  let Transaction { inputs, reference_inputs, .. } = transaction
  expect [registry_input] =
    list.filter(
      list.concat(inputs, reference_inputs),
      fn(input) { input.output |> auth.contain_auth_token(registry_token) },
    )

  expect registry_datum: BridgeRegistryDatum =
    validator_utils.get_inline_datum(registry_input.output)
  registry_datum
}

pub fn is_active_voucher(
  datum: BridgeRegistryDatum,
  policy_id: PolicyId,
) -> Bool {
  datum.active_voucher_policy_id == policy_id
}

pub fn is_legacy_voucher(
  datum: BridgeRegistryDatum,
  policy_id: PolicyId,
) -> Bool {
  list.has(datum.legacy_voucher_policy_ids, policy_id)
}

pub fn is_operational_voucher(
  datum: BridgeRegistryDatum,
  policy_id: PolicyId,
) -> Bool {
  is_active_voucher(datum, policy_id) || is_legacy_voucher(datum, policy_id)
}

pub fn registry_output_is_valid(
  input: Input,
  output: Output,
  registry_token: AuthToken,
) -> Bool {
  and {
    input.output |> auth.contain_auth_token(registry_token),
    output |> auth.contain_auth_token(registry_token),
    output.address == input.output.address,
  }
}
