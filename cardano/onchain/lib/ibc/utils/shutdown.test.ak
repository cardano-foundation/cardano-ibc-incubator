use aiken/interval
use cardano/address.{from_script, from_verification_key}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateControl, HostStateDatum, ShuttingDown,
  host_state_token_name,
}
use ibc/utils/shutdown

const host_policy = #"11111111111111111111111111111111111111111111111111111111"

const state_policy = #"22222222222222222222222222222222222222222222222222222222"

const deployer = #"33333333333333333333333333333333333333333333333333333333"

const grace_end = 86_401_000

fn datum() -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: 1,
      ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
      next_client_sequence: 1,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 1000,
    },
    nft_policy: host_policy,
    deployer,
    control: HostStateControl {
      port_registry: [],
      shutdown: ShuttingDown { initiated_at: 1000, grace_period_end: grace_end },
    },
  }
}

fn fixture() -> Transaction {
  let input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        output_index: 0,
      },
      output: Output {
        address: from_script("state"),
        value: assets.from_lovelace(5_000_000)
          |> assets.add(state_policy, "state", 1)
          |> assets.add("unrelated", "asset", 7),
        datum: NoDatum,
        reference_script: None,
      },
    }
  let host =
    Input {
      output_reference: OutputReference {
        transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        output_index: 0,
      },
      output: Output {
        address: from_script("host"),
        value: assets.from_lovelace(5_000_000)
          |> assets.add(host_policy, host_state_token_name, 1),
        datum: InlineDatum(datum()),
        reference_script: None,
      },
    }
  Transaction {
    ..transaction.placeholder,
    inputs: [input],
    reference_inputs: [host],
    outputs: [
      Output {
        ..input.output,
        address: from_verification_key(deployer),
        value: assets.from_lovelace(5_000_000)
          |> assets.add("unrelated", "asset", 7),
      },
    ],
    mint: assets.from_asset(state_policy, "state", -1),
    extra_signatories: [deployer],
    validity_range: interval.after(grace_end),
  }
}

fn check(tx: Transaction) -> Bool {
  shutdown.reclaim_policy(tx, state_policy, host_policy)
}

test reclaim_returns_ada_and_unrelated_assets_after_grace() {
  check(fixture())
}

test reclaim_requires_deployer_signature() fail {
  check(Transaction { ..fixture(), extra_signatories: [] })
}

test reclaim_rejects_early_withdrawal() fail {
  check(
    Transaction { ..fixture(), validity_range: interval.after(grace_end - 1) },
  )
}

test reclaim_requires_finite_lower_bound() fail {
  check(
    Transaction { ..fixture(), validity_range: interval.before(grace_end + 1) },
  )
}

test reclaim_rejects_active_deployment() fail {
  let tx = fixture()
  expect [host] = tx.reference_inputs
  let old = datum()
  let active =
    HostStateDatum {
      ..old,
      control: HostStateControl { ..old.control, shutdown: Active },
    }
  check(
    Transaction {
      ..tx,
      reference_inputs: [
        Input {
          ..host,
          output: Output { ..host.output, datum: InlineDatum(active) },
        },
      ],
    },
  )
}

test reclaim_rejects_unrelated_host() fail {
  let tx = fixture()
  expect [host] = tx.reference_inputs
  check(
    Transaction {
      ..tx,
      reference_inputs: [
        Input {
          ..host,
          output: Output {
            ..host.output,
            value: assets.from_lovelace(5_000_000),
          },
        },
      ],
    },
  )
}

test reclaim_rejects_payment_to_another_key() {
  let tx = fixture()
  expect [output] = tx.outputs
  !check(
    Transaction {
      ..tx,
      outputs: [
        Output { ..output, address: from_verification_key("another key") },
      ],
    },
  )
}

test reclaim_rejects_using_reserves_for_fees() {
  let tx = fixture()
  expect [output] = tx.outputs
  !check(
    Transaction {
      ..tx,
      outputs: [
        Output { ..output, value: assets.add(output.value, "", "", -1) },
      ],
    },
  )
}

test reclaim_rejects_losing_unrelated_assets() {
  let tx = fixture()
  expect [output] = tx.outputs
  !check(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          value: assets.add(output.value, "unrelated", "asset", -1),
        },
      ],
    },
  )
}

test reclaim_rejects_reusing_one_payment_for_two_states() {
  let tx = fixture()
  expect [input] = tx.inputs
  let second =
    Input {
      output_reference: OutputReference {
        ..input.output_reference,
        output_index: 1,
      },
      output: Output {
        ..input.output,
        value: assets.from_lovelace(5_000_000)
          |> assets.add(state_policy, "second", 1),
      },
    }
  !check(
    Transaction {
      ..tx,
      inputs: [input, second],
      mint: assets.add(tx.mint, state_policy, "second", -1),
    },
  )
}

test reclaim_rejects_mixing_script_addresses() fail {
  let tx = fixture()
  expect [input] = tx.inputs
  let other =
    Input {
      output_reference: OutputReference {
        ..input.output_reference,
        output_index: 1,
      },
      output: Output {
        ..input.output,
        address: from_script("another script"),
        value: assets.from_lovelace(1),
      },
    }
  check(Transaction { ..tx, inputs: [input, other] })
}

test reclaim_rejects_leaving_the_state_token_alive() {
  !check(Transaction { ..fixture(), mint: assets.zero })
}
