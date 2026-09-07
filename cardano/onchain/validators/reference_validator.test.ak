use aiken/interval
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, Value, from_asset, from_lovelace, zero}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Redeemer, Spend,
  Transaction, placeholder,
}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateControl, HostStateDatum, ShuttingDown,
  empty_ibc_state_root, host_state_token_name,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  FinalizeShutdown, Heartbeat, HostStateRedeemer,
}
use reference_validator

const trusted_deployer =
  #"00000000000000000000000000000000000000000000000000000000"

fn test_nft_policy() -> PolicyId {
  #"b377ba1758b1fdea633a60e494f085d59c7799448b0913cc2c6ca753"
}

fn host_script_hash() -> ByteArray {
  #"f15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b371"
}

fn other_script_hash() -> ByteArray {
  #"a15f344ae918ebb7daf88fe7afa3737a9d4884d3aec39b64d177b372"
}

fn host_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"29cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5a",
    output_index: 0,
  }
}

fn own_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"39cb4f757221692c87f44398681f46322575ce72d5ebf08e14548b9c41a75a5b",
    output_index: 0,
  }
}

fn shutdown_host_state_datum(grace_period_end: Int) -> HostStateDatum {
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
    nft_policy: test_nft_policy(),
    deployer: trusted_deployer,
    control: HostStateControl {
      port_registry: [],
      shutdown: ShuttingDown {
        initiated_at: state.last_update_time,
        grace_period_end,
      },
    },
  }
}

fn host_state_input(grace_period_end: Int) -> Input {
  Input(
    host_ref(),
    Output {
      address: Address(Script(host_script_hash()), None),
      value: from_asset(test_nft_policy(), host_state_token_name, 1),
      datum: InlineDatum(shutdown_host_state_datum(grace_period_end)),
      reference_script: None,
    },
  )
}

fn ordinary_reference_input() -> Input {
  Input(
    own_ref(),
    Output {
      address: Address(Script(other_script_hash()), None),
      value: from_lovelace(2_000_000),
      datum: InlineDatum(Void),
      reference_script: Some(other_script_hash()),
    },
  )
}

fn terminal_reference_input() -> Input {
  let input = ordinary_reference_input()
  Input {
    ..input,
    output: Output {
      ..input.output,
      reference_script: Some(host_script_hash()),
    },
  }
}

fn normal_reclaim_transaction(valid_from: Int, signed: Bool) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [ordinary_reference_input()],
    reference_inputs: [host_state_input(5000)],
    extra_signatories: if signed {
      [trusted_deployer]
    } else {
      []
    },
    validity_range: interval.after(valid_from),
  }
}

fn terminal_transaction(
  host_redeemer: HostStateRedeemer,
  mint: Value,
  outputs: List<Output>,
) -> Transaction {
  let spend_redeemer: Redeemer = host_redeemer
  Transaction {
    ..placeholder,
    inputs: [host_state_input(5000), terminal_reference_input()],
    outputs,
    mint,
    redeemers: [Pair(Spend(host_ref()), spend_redeemer)],
    extra_signatories: [trusted_deployer],
    validity_range: interval.after(5000),
  }
}

fn validate(transaction: Transaction) -> Bool {
  reference_validator.refer_only.spend(
    test_nft_policy(),
    None,
    Void,
    own_ref(),
    transaction,
  )
}

test reference_validator_reclaim_succeeds_after_grace_period() {
  validate(normal_reclaim_transaction(5000, True))
}

test reference_validator_reclaim_fails_before_grace_period() fail {
  validate(normal_reclaim_transaction(4999, True))
}

test reference_validator_reclaim_fails_without_deployer_signature() fail {
  validate(normal_reclaim_transaction(5000, False))
}

test reference_validator_preserves_terminal_host_reference() fail {
  let transaction = normal_reclaim_transaction(5000, True)
  validate(Transaction { ..transaction, inputs: [terminal_reference_input()] })
}

test reference_validator_terminal_reclaim_succeeds_with_finalize_and_burn() {
  validate(
    terminal_transaction(
      FinalizeShutdown,
      from_asset(test_nft_policy(), host_state_token_name, -1),
      [],
    ),
  )
}

test reference_validator_terminal_reclaim_rejects_wrong_host_redeemer() fail {
  validate(
    terminal_transaction(
      Heartbeat,
      from_asset(test_nft_policy(), host_state_token_name, -1),
      [],
    ),
  )
}

test reference_validator_terminal_reclaim_rejects_without_burn() fail {
  validate(terminal_transaction(FinalizeShutdown, zero, []))
}

test reference_validator_terminal_reclaim_rejects_wrong_reference_script() fail {
  let transaction =
    terminal_transaction(
      FinalizeShutdown,
      from_asset(test_nft_policy(), host_state_token_name, -1),
      [],
    )
  validate(
    Transaction {
      ..transaction,
      inputs: [host_state_input(5000), ordinary_reference_input()],
    },
  )
}

test reference_validator_terminal_reclaim_rejects_nft_output() fail {
  let output =
    Output {
      address: Address(Script(other_script_hash()), None),
      value: from_asset(test_nft_policy(), host_state_token_name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  validate(
    terminal_transaction(
      FinalizeShutdown,
      from_asset(test_nft_policy(), host_state_token_name, -1),
      [output],
    ),
  )
}
