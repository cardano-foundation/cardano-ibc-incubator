use aiken/collection/list
use aiken/collection/pairs
use cardano/address as address
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Spend, Transaction, find_input}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostStateDatum, ShuttingDown, host_state_token_name, is_shutting_down,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  FinalizeShutdown, HostStateRedeemer,
}
use ibc/utils/validator_utils

fn has_host_state_nft(input: Input, host_state_nft_policy_id: PolicyId) -> Bool {
  assets.has_nft(
    input.output.value,
    host_state_nft_policy_id,
    host_state_token_name,
  )
}

fn validate_shutdown_authority(
  host_input: Input,
  host_state_nft_policy_id: PolicyId,
  transaction: Transaction,
) -> Bool {
  let Transaction { extra_signatories, validity_range, .. } = transaction
  expect host_state_datum: HostStateDatum =
    validator_utils.get_inline_datum(host_input.output)
  expect host_state_datum.control.shutdown |> is_shutting_down
  and {
    host_state_datum.nft_policy == host_state_nft_policy_id,
    list.has(extra_signatories, host_state_datum.deployer),
    when host_state_datum.control.shutdown is {
      ShuttingDown { grace_period_end, .. } ->
        validator_utils.get_tx_valid_from(validity_range) >= grace_period_end
      Active -> False
    },
  }
}

validator refer_only(host_state_nft_policy_id: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { inputs, reference_inputs, redeemers, mint, outputs, .. } =
      transaction
    expect Some(own_input) = find_input(inputs, own_ref)
    expect Some(own_reference_script_hash) = own_input.output.reference_script
    let consumed_host_inputs =
      list.filter(
        inputs,
        fn(input) { has_host_state_nft(input, host_state_nft_policy_id) },
      )

    when consumed_host_inputs is {
      [host_input] -> {
        expect address.Script(host_script_hash) =
          host_input.output.address.payment_credential
        expect own_reference_script_hash == host_script_hash
        expect Some(host_redeemer_data) =
          pairs.get_first(redeemers, Spend(host_input.output_reference))
        expect host_redeemer: HostStateRedeemer = host_redeemer_data
        expect FinalizeShutdown = host_redeemer
        and {
          validate_shutdown_authority(
            host_input,
            host_state_nft_policy_id,
            transaction,
          ),
          validator_utils.require_exact_marker_mint(
            mint,
            host_state_nft_policy_id,
            host_state_token_name,
            -1,
          ),
          !list.any(
            outputs,
            fn(output) {
              assets.has_nft(
                output.value,
                host_state_nft_policy_id,
                host_state_token_name,
              )
            },
          ),
        }
      }
      [] -> {
        expect [host_input] =
          list.filter(
            reference_inputs,
            fn(input) { has_host_state_nft(input, host_state_nft_policy_id) },
          )
        expect address.Script(host_script_hash) =
          host_input.output.address.payment_credential
        and {
          // The HostState STT reference is kept for the atomic finalization.
          own_reference_script_hash != host_script_hash,
          validate_shutdown_authority(
            host_input,
            host_state_nft_policy_id,
            transaction,
          ),
        }
      }
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
