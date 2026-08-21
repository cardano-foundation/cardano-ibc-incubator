use aiken/interval
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Redeemer, Spend,
  Transaction, placeholder,
}
use host_state_nft
use host_state_stt
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, Sealed, ShutdownState, ShuttingDown,
  empty_ibc_state_root, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{ReclaimHostState}
use ibc/core/ics_025_handler_interface/reclamation

const nft_policy: PolicyId =
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

const deployer = #"11111111111111111111111111111111111111111111111111111111"

const reclaim_to = #"22222222222222222222222222222222222222222222222222222222"

const other_reclaim_to =
  #"33333333333333333333333333333333333333333333333333333333"

const host_ref =
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: 0,
  }

const seed_ref =
  OutputReference {
    transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
    output_index: 0,
  }

fn host_datum(shutdown: ShutdownState) -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: 2,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 1,
      next_connection_sequence: 1,
      next_channel_sequence: 1,
      bound_port: [],
      last_update_time: 5_000,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    },
    nft_policy,
    deployer,
    shutdown,
  }
}

fn host_input(shutdown: ShutdownState) -> Input {
  Input {
    output_reference: host_ref,
    output: Output {
      address: from_script(
        #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371",
      ),
      value: assets.from_lovelace(2_000_000)
        |> assets.add(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(host_datum(shutdown)),
      reference_script: None,
    },
  }
}

fn validate_burn_final(
  shutdown: ShutdownState,
  valid_from: Int,
  policy_reclaim_to,
  host_reclaim_to,
  has_signature: Bool,
) -> Bool {
  let host_redeemer: Redeemer = ReclaimHostState { reclaim_to: host_reclaim_to }
  let transaction =
    Transaction {
      ..placeholder,
      inputs: [host_input(shutdown)],
      outputs: [
        Output {
          address: from_verification_key(host_reclaim_to),
          value: assets.from_lovelace(2_000_000),
          datum: NoDatum,
          reference_script: None,
        },
      ],
      mint: assets.from_asset(nft_policy, host_state_token_name, -1),
      redeemers: [Pair(Spend(host_ref), host_redeemer)],
      extra_signatories: if has_signature {
        [deployer]
      } else {
        []
      },
      validity_range: interval.after(valid_from),
    }

  let dummy_script_hash =
    #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
  and {
    host_state_nft.host_state_nft.mint(
      seed_ref,
      host_state_nft.BurnFinal { reclaim_to: policy_reclaim_to },
      nft_policy,
      transaction,
    ),
    host_state_stt.host_state_stt.spend(
      nft_policy,
      dummy_script_hash,
      dummy_script_hash,
      dummy_script_hash,
      nft_policy,
      nft_policy,
      nft_policy,
      nft_policy,
      nft_policy,
      nft_policy,
      nft_policy,
      None,
      ReclaimHostState { reclaim_to: host_reclaim_to },
      host_ref,
      transaction,
    ),
  }
}

test burn_final_accepts_sealed_anchor_after_proof_window() {
  let sealed_at = 5_000
  let proof_window_end = reclamation.proof_window_end(sealed_at)
  validate_burn_final(
    Sealed { sealed_at, proof_window_end },
    proof_window_end,
    reclaim_to,
    reclaim_to,
    True,
  )
}

test burn_final_rejects_before_terminal_proof_window() fail {
  let sealed_at = 5_000
  let proof_window_end = reclamation.proof_window_end(sealed_at)
  validate_burn_final(
    Sealed { sealed_at, proof_window_end },
    proof_window_end - 1,
    reclaim_to,
    reclaim_to,
    True,
  )
}

test burn_final_rejects_unsealed_shutdown_anchor() fail {
  let grace_period_end = 5_000
  validate_burn_final(
    ShuttingDown { initiated_at: 2_000, grace_period_end },
    grace_period_end + reclamation.host_state_proof_window,
    reclaim_to,
    reclaim_to,
    True,
  )
}

test burn_final_rejects_mismatched_host_reclaim_target() fail {
  let sealed_at = 5_000
  let proof_window_end = reclamation.proof_window_end(sealed_at)
  validate_burn_final(
    Sealed { sealed_at, proof_window_end },
    proof_window_end,
    reclaim_to,
    other_reclaim_to,
    True,
  )
}

test burn_final_rejects_missing_deployer_signature() fail {
  let sealed_at = 5_000
  let proof_window_end = reclamation.proof_window_end(sealed_at)
  validate_burn_final(
    Sealed { sealed_at, proof_window_end },
    proof_window_end,
    reclaim_to,
    reclaim_to,
    False,
  )
}
