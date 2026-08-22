use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name, is_host_state_reclaimable,
}
use ibc/utils/validator_utils

validator refer_only(host_state_nft_policy_id: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      reference_inputs,
      extra_signatories,
      validity_range,
      ..
    } = transaction

    expect [host_input] =
      list.filter(
        list.concat(inputs, reference_inputs),
        fn(input) {
          assets.has_nft(
            input.output.value,
            host_state_nft_policy_id,
            host_state_token_name,
          )
        },
      )
    expect host_state_datum: HostStateDatum =
      validator_utils.get_inline_datum(host_input.output)
    expect list.has(extra_signatories, host_state_datum.deployer)
    is_host_state_reclaimable(
      host_state_datum,
      validator_utils.get_tx_valid_from(validity_range),
    )
  }

  else(_) {
    fail
  }
}
