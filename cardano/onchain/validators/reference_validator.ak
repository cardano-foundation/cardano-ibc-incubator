use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostStateDatum, ShuttingDown, host_state_token_name, is_shutting_down,
}
use ibc/utils/validator_utils

validator refer_only(host_state_nft_policy_id: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { reference_inputs, extra_signatories, validity_range, .. } =
      transaction

    expect [host_input] =
      list.filter(
        reference_inputs,
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
    expect host_state_datum.shutdown |> is_shutting_down
    expect list.has(extra_signatories, host_state_datum.deployer)

    when host_state_datum.shutdown is {
      ShuttingDown { grace_period_end, .. } ->
        validator_utils.get_tx_valid_from(validity_range) >= grace_period_end
      Active -> False
    }
  }

  else(_) {
    fail
  }
}
