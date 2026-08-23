use aiken/collection/list
use aiken/collection/pairs
use cardano/address as address
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Spend, Transaction, find_input}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, ReferenceScriptIdentity, host_state_token_name,
  is_host_state_reclaimable_with_terminal_reference,
  is_reference_script_reclaimable,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HostStateRedeemer, ReclaimHostState, ReclaimReferenceScripts,
}
use ibc/utils/validator_utils

validator refer_only(host_state_nft_policy_id: PolicyId) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      extra_signatories,
      validity_range,
      mint,
      ..
    } = transaction

    expect [host_input] =
      list.filter(
        inputs,
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
    expect Some(host_redeemer_raw) =
      pairs.get_first(redeemers, Spend(host_input.output_reference))
    expect host_redeemer: HostStateRedeemer = host_redeemer_raw
    expect Some(own_input) = find_input(inputs, own_ref)
    expect Some(own_reference_script_hash) = own_input.output.reference_script
    expect address.Script(own_validator_hash) =
      own_input.output.address.payment_credential
    let own_identity =
      ReferenceScriptIdentity {
        output_reference: own_ref,
        reference_script_hash: own_reference_script_hash,
      }
    expect address.Script(host_script_hash) =
      host_input.output.address.payment_credential
    expect list.has(extra_signatories, host_state_datum.deployer)
    when host_redeemer is {
      ReclaimReferenceScripts { predecessor_root } -> {
        expect [host_output] =
          list.filter(
            outputs,
            fn(output) {
              assets.has_nft(
                output.value,
                host_state_nft_policy_id,
                host_state_token_name,
              )
            },
          )
        expect successor_datum: HostStateDatum =
          validator_utils.get_inline_datum(host_output)
        expect Some(old_count) = host_state_datum.live_reference_script_count
        expect Some(new_count) = successor_datum.live_reference_script_count
        and {
          new_count < old_count,
          successor_datum.reference_script_inventory_root == predecessor_root,
          successor_datum.reference_script_registration == host_state_datum.reference_script_registration,
          is_reference_script_reclaimable(
            host_state_datum,
            validator_utils.get_tx_valid_from(validity_range),
          ),
        }
      }
      ReclaimHostState { .. } -> and {
          list.is_empty(
            transaction.find_script_outputs(outputs, own_validator_hash),
          ),
          list.is_empty(
            list.filter(
              outputs,
              fn(output) {
                assets.has_nft(
                  output.value,
                  host_state_nft_policy_id,
                  host_state_token_name,
                )
              },
            ),
          ),
          auth.burn_auth_token(
            mint,
            AuthToken {
              policy_id: host_state_nft_policy_id,
              name: host_state_token_name,
            },
          ),
          is_host_state_reclaimable_with_terminal_reference(
            host_state_datum,
            own_identity,
            validator_utils.get_tx_valid_from(validity_range),
            host_script_hash,
          ),
        }
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
