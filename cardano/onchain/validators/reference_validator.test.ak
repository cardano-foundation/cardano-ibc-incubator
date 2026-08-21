use aiken/interval
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, Sealed, ShuttingDown, empty_ibc_state_root,
  host_state_token_name,
}
use reference_validator

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

fn sealed_host_state_datum(
  nft_policy: PolicyId,
  proof_window_end: Int,
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
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    }

  HostStateDatum {
    state,
    nft_policy,
    deployer: trusted_deployer,
    shutdown: Sealed { sealed_at: state.last_update_time, proof_window_end },
  }
}

fn host_state_input(nft_policy: PolicyId, proof_window_end: Int) -> Input {
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
      datum: InlineDatum(sealed_host_state_datum(nft_policy, proof_window_end)),
      reference_script: None,
    },
  )
}

test reference_validator_reclaim_succeeds_after_proof_window() {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let proof_window_end = 5000
  let own_ref =
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    }

  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [host_state_input(nft_policy, proof_window_end)],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(proof_window_end),
    }

  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    own_ref,
    transaction,
  )
}

test reference_validator_reclaim_fails_before_proof_window() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let proof_window_end = 5000
  let own_ref =
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    }

  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [host_state_input(nft_policy, proof_window_end)],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(proof_window_end - 1),
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
  let proof_window_end = 5000
  let own_ref =
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    }

  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [host_state_input(nft_policy, proof_window_end)],
      validity_range: interval.after(proof_window_end),
    }

  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    own_ref,
    transaction,
  )
}

test reference_validator_reclaim_rejects_unsealed_shutdown_anchor() fail {
  let nft_policy: PolicyId =
    #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
  let proof_window_end = 5000
  let sealed = sealed_host_state_datum(nft_policy, proof_window_end)
  let shutting_down =
    HostStateDatum {
      ..sealed,
      shutdown: ShuttingDown {
        initiated_at: sealed.state.last_update_time,
        grace_period_end: proof_window_end - 1,
      },
    }
  let input =
    Input {
      ..host_state_input(nft_policy, proof_window_end),
      output: Output {
        ..host_state_input(nft_policy, proof_window_end).output,
        datum: InlineDatum(shutting_down),
      },
    }
  let transaction =
    Transaction {
      ..placeholder,
      reference_inputs: [input],
      extra_signatories: [trusted_deployer],
      validity_range: interval.after(proof_window_end),
    }

  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    OutputReference {
      transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
      output_index: 0,
    },
    transaction,
  )
}
