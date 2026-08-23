use aiken/interval
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Spend, Transaction,
  placeholder,
}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ReferenceScriptRegistration, Sealed, ShuttingDown,
  empty_ibc_state_root, empty_reference_script_inventory_root,
  host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  Heartbeat, ReclaimHostState, ReclaimReferenceScripts,
}
use reference_validator

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

const nft_policy: PolicyId =
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"

const host_ref =
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: 0,
  }

const own_ref =
  OutputReference {
    transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
    output_index: 0,
  }

const host_script_hash =
  #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"

fn terminal_identity() -> host_state.ReferenceScriptIdentity {
  host_state.ReferenceScriptIdentity {
    output_reference: own_ref,
    reference_script_hash: host_script_hash,
  }
}

fn terminal_root() -> ByteArray {
  host_state.fold_reference_script_identities_in_order(
    empty_reference_script_inventory_root,
    [terminal_identity()],
  )
}

fn host_datum(count: Int, proof_window_end: Int, version: Int) -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 2_000 + version,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    },
    nft_policy,
    deployer: trusted_deployer,
    shutdown: Sealed { sealed_at: 2_000, proof_window_end },
    live_reference_script_count: Some(count),
    reference_script_inventory_root: #"1111111111111111111111111111111111111111111111111111111111111111",
    reference_script_registration: Some(
      ReferenceScriptRegistration {
        target_count: 3,
        target_root: #"1111111111111111111111111111111111111111111111111111111111111111",
        last_out_ref: own_ref,
      },
    ),
  }
}

fn host_input(count: Int, proof_window_end: Int) -> Input {
  Input(
    host_ref,
    Output {
      address: Address(Script(host_script_hash), None),
      value: from_asset(nft_policy, host_state_token_name, 1),
      datum: InlineDatum(host_datum(count, proof_window_end, 1)),
      reference_script: None,
    },
  )
}

fn terminal_host_input(proof_window_end: Int) -> Input {
  let input = host_input(1, proof_window_end)
  let datum =
    HostStateDatum {
      ..host_datum(1, proof_window_end, 1),
      reference_script_inventory_root: terminal_root(),
      reference_script_registration: Some(
        ReferenceScriptRegistration {
          target_count: 3,
          target_root: #"1111111111111111111111111111111111111111111111111111111111111111",
          last_out_ref: own_ref,
        },
      ),
    }
  Input {
    ..input,
    output: Output { ..input.output, datum: InlineDatum(datum) },
  }
}

fn host_output(count: Int, proof_window_end: Int) -> Output {
  let successor =
    HostStateDatum {
      ..host_datum(count, proof_window_end, 2),
      reference_script_inventory_root: empty_reference_script_inventory_root,
    }
  Output {
    ..host_input(count, proof_window_end).output,
    datum: InlineDatum(successor),
  }
}

fn own_input() -> Input {
  Input(
    own_ref,
    Output {
      address: Address(
        Script(#"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        None,
      ),
      value: assets.from_lovelace(2_000_000),
      datum: InlineDatum(Void),
      reference_script: Some(
        #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    },
  )
}

fn terminal_own_input() -> Input {
  let input = own_input()
  Input {
    ..input,
    output: Output { ..input.output, reference_script: Some(host_script_hash) },
  }
}

fn terminal_transaction(proof_window_end: Int) -> Transaction {
  let host_redeemer: Redeemer =
    ReclaimHostState { reclaim_to: trusted_deployer }
  Transaction {
    ..placeholder,
    inputs: [terminal_host_input(proof_window_end), terminal_own_input()],
    outputs: [],
    mint: assets.from_asset(nft_policy, host_state_token_name, -1),
    redeemers: [Pair(Spend(host_ref), host_redeemer)],
    extra_signatories: [trusted_deployer],
    validity_range: interval.after(proof_window_end),
  }
}

fn transaction_for_batch(
  old_count: Int,
  new_count: Int,
  proof_window_end: Int,
) -> Transaction {
  let host_redeemer: Redeemer =
    ReclaimReferenceScripts {
      predecessor_root: empty_reference_script_inventory_root,
    }
  Transaction {
    ..placeholder,
    inputs: [host_input(old_count, proof_window_end), own_input()],
    outputs: [host_output(new_count, proof_window_end)],
    redeemers: [Pair(Spend(host_ref), host_redeemer)],
    extra_signatories: [trusted_deployer],
    validity_range: interval.after(proof_window_end),
  }
}

fn validate(transaction: Transaction) -> Bool {
  reference_validator.refer_only.spend(
    nft_policy,
    None,
    Void,
    own_ref,
    transaction,
  )
}

test first_reference_reclaim_batch_requires_a_live_host_transition() {
  validate(transaction_for_batch(3, 2, 5_000))
}

test intermediate_reference_reclaim_batch_remains_available() {
  validate(transaction_for_batch(2, 1, 5_000))
}

test final_reference_reclaim_atomically_burns_the_host_anchor() {
  validate(terminal_transaction(5_000))
}

test final_reference_reclaim_rejects_the_wrong_host_reference_hash() fail {
  let transaction = terminal_transaction(5_000)
  let wrong_reference = own_input()
  validate(
    Transaction {
      ..transaction,
      inputs: [terminal_host_input(5_000), wrong_reference],
    },
  )
}

test final_reference_reclaim_rejects_a_wrong_inventory_root() fail {
  let transaction = terminal_transaction(5_000)
  let host = terminal_host_input(5_000)
  expect InlineDatum(raw_datum) = host.output.datum
  expect datum: HostStateDatum = raw_datum
  let wrong_datum =
    HostStateDatum {
      ..datum,
      reference_script_inventory_root: empty_reference_script_inventory_root,
    }
  let wrong_host =
    Input {
      ..host,
      output: Output { ..host.output, datum: InlineDatum(wrong_datum) },
    }
  validate(
    Transaction { ..transaction, inputs: [wrong_host, terminal_own_input()] },
  )
}

test final_reference_reclaim_rejects_without_the_nft_burn() fail {
  validate(Transaction { ..terminal_transaction(5_000), mint: assets.zero })
}

test final_reference_reclaim_rejects_before_the_proof_window() fail {
  validate(
    Transaction {
      ..terminal_transaction(5_000),
      validity_range: interval.after(4_999),
    },
  )
}

test final_reference_reclaim_rejects_an_output_at_the_reference_validator() fail {
  let transaction = terminal_transaction(5_000)
  validate(
    Transaction { ..transaction, outputs: [terminal_own_input().output] },
  )
}

test reference_reclaim_rejects_a_read_only_host_anchor() fail {
  let transaction = transaction_for_batch(1, 0, 5_000)
  validate(
    Transaction {
      ..transaction,
      inputs: [own_input()],
      reference_inputs: [host_input(1, 5_000)],
    },
  )
}

test reference_reclaim_rejects_the_wrong_host_redeemer() fail {
  let transaction = transaction_for_batch(1, 0, 5_000)
  let wrong_redeemer: Redeemer = Heartbeat
  validate(
    Transaction {
      ..transaction,
      redeemers: [Pair(Spend(host_ref), wrong_redeemer)],
    },
  )
}

test reference_reclaim_rejects_a_missing_host_successor() fail {
  validate(Transaction { ..transaction_for_batch(1, 0, 5_000), outputs: [] })
}

test reference_reclaim_rejects_a_non_decreasing_inventory() fail {
  validate(transaction_for_batch(1, 1, 5_000))
}

test reference_reclaim_rejects_a_successor_not_bound_to_the_predecessor() fail {
  let transaction = transaction_for_batch(1, 0, 5_000)
  let wrong_successor = host_datum(0, 5_000, 2)
  validate(
    Transaction {
      ..transaction,
      outputs: [
        Output { ..host_output(0, 5_000), datum: InlineDatum(wrong_successor) },
      ],
    },
  )
}

test reference_reclaim_rejects_before_the_proof_window() fail {
  let transaction = transaction_for_batch(1, 0, 5_000)
  validate(Transaction { ..transaction, validity_range: interval.after(4_999) })
}

test reference_reclaim_rejects_without_the_deployer_signature() fail {
  validate(
    Transaction { ..transaction_for_batch(1, 0, 5_000), extra_signatories: [] },
  )
}

test reference_reclaim_rejects_an_unsealed_host() fail {
  let transaction = transaction_for_batch(1, 0, 5_000)
  let old = host_datum(1, 5_000, 1)
  let unsealed =
    HostStateDatum {
      ..old,
      shutdown: ShuttingDown { initiated_at: 1_000, grace_period_end: 2_000 },
    }
  let input =
    Input {
      ..host_input(1, 5_000),
      output: Output {
        ..host_input(1, 5_000).output,
        datum: InlineDatum(unsealed),
      },
    }
  validate(Transaction { ..transaction, inputs: [input, own_input()] })
}

test reference_reclaim_requires_its_own_input_to_carry_a_reference_script() fail {
  let transaction = transaction_for_batch(1, 0, 5_000)
  let without_script =
    Input {
      ..own_input(),
      output: Output { ..own_input().output, reference_script: None },
    }
  validate(
    Transaction {
      ..transaction,
      inputs: [host_input(1, 5_000), without_script],
    },
  )
}
