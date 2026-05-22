use aiken/interval
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ShuttingDown, empty_ibc_state_root,
  host_state_token_name,
}
use reference_validator

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

fn shutdown_host_state_datum(
  nft_policy: PolicyId,
  grace_period_end: Int,
) -> HostStateDatum {
  let state =
    HostState {
      version: 1,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 2000,
    }

  HostStateDatum {
    state,
    nft_policy,
    deployer: trusted_deployer,
    shutdown: ShuttingDown {
      initiated_at: state.last_update_time,
      grace_period_end,
    },
  }
}

fn host_state_input(nft_policy: PolicyId, grace_period_end: Int) -> Input {
  Input(
    OutputReference {
      transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
      output_index: 0,
    },
    Output {
      address: Address(
        Script(#"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"),
        None,
      ),
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(
        shutdown_host_state_datum(nft_policy, grace_period_end),
      ),
      reference_script: None,
    },
  )
}

test reference_validator_reclaim_succeeds_after_grace_period() {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let grace_period_end = 5000
  let own_ref =
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    }

  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [host_state_input(nft_policy, grace_period_end)],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(grace_period_end),
    }

  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    own_ref,
    transaction,
  )
}

test reference_validator_reclaim_fails_before_grace_period() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let grace_period_end = 5000
  let own_ref =
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    }

  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [host_state_input(nft_policy, grace_period_end)],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(grace_period_end - 1),
    }

  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    own_ref,
    transaction,
  )
}

test reference_validator_reclaim_fails_without_deployer_signature() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let grace_period_end = 5000
  let own_ref =
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    }

  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [host_state_input(nft_policy, grace_period_end)],
      validity_range: interval.after(grace_period_end),
    }

  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    own_ref,
    transaction,
  )
}
