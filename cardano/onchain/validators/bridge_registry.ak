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

    True
  }

  else(_) {
    fail
  }
}
