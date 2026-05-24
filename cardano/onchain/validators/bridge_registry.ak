use aiken/collection/list
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use ibc/apps/transfer/bridge_registry.{BridgeRegistryDatum} as bridge_registry_lib
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

pub type BridgeRegistryRedeemer {
  UpdateBridgeRegistry
}

validator bridge_registry(registry_token: AuthToken) {
  spend(
    _datum: Option<Data>,
    redeemer: BridgeRegistryRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let UpdateBridgeRegistry = redeemer
    let Transaction { inputs, outputs, extra_signatories, .. } = transaction

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    expect input_datum: bridge_registry_lib.BridgeRegistryDatum =
      validator_utils.get_inline_datum(spent_input.output)
    expect list.has(extra_signatories, input_datum.governance_key_hash)

    expect [continuing_output] =
      list.filter(
        outputs,
        fn(output) {
          bridge_registry_lib.registry_output_is_valid(
            spent_input,
            output,
            registry_token,
          )
        },
      )
    expect InlineDatum(_) = continuing_output.datum
    expect output_datum: bridge_registry_lib.BridgeRegistryDatum =
      validator_utils.get_inline_datum(continuing_output)
    expect output_datum.governance_key_hash == input_datum.governance_key_hash
    expect registry_upgrade_preserves_voucher_support(input_datum, output_datum)

    True
  }

  else(_) {
    fail
  }
}

fn registry_upgrade_preserves_voucher_support(
  input_datum: bridge_registry_lib.BridgeRegistryDatum,
  output_datum: bridge_registry_lib.BridgeRegistryDatum,
) -> Bool {
  and {
    list.has(
      output_datum.legacy_voucher_policy_ids,
      input_datum.active_voucher_policy_id,
    )?,
    list.all(
      input_datum.legacy_voucher_policy_ids,
      fn(policy_id) {
        list.has(output_datum.legacy_voucher_policy_ids, policy_id)
      },
    )?,
    !list.has(
      output_datum.legacy_voucher_policy_ids,
      output_datum.active_voucher_policy_id,
    )?,
    policy_ids_are_unique(output_datum.legacy_voucher_policy_ids)?,
  }
}

fn policy_ids_are_unique(policy_ids: List<ByteArray>) -> Bool {
  when policy_ids is {
    [] -> True
    [policy_id, ..rest] ->
      !list.has(rest, policy_id) && policy_ids_are_unique(rest)
  }
}
