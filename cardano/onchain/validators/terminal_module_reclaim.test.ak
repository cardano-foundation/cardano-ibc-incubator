use cardano/address.{Address, Script, from_verification_key}
use cardano/assets.{PolicyId, ada_asset_name, ada_policy_id, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer, Spend,
  Transaction,
}
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnHostStateSeal}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, ModuleRegistration, ShuttingDown,
  host_state_token_name, retired_port_marker,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{ReclaimModule}
use ibc/core/ics_025_handler_interface/lifecycle_marker.{
  AuthorizeTransferModuleReclaim, lifecycle_marker_token_name,
}
use minting_lifecycle_marker
use spending_mock_module
use spending_transfer_module

const deployer = #"00000000000000000000000000000000000000000000000000000000"

const host_policy: PolicyId =
  #"11111111111111111111111111111111111111111111111111111111"

const module_script_hash =
  #"22222222222222222222222222222222222222222222222222222222"

const host_script_hash =
  #"33333333333333333333333333333333333333333333333333333333"

const shard_policy: PolicyId =
  #"44444444444444444444444444444444444444444444444444444444"

const channel_policy: PolicyId =
  #"55555555555555555555555555555555555555555555555555555555"

const voucher_policy: PolicyId =
  #"66666666666666666666666666666666666666666666666666666666"

const lifecycle_policy: PolicyId =
  #"69696969696969696969696969696969696969696969696969696969"

const port_id = "transfer"

const port_token =
  AuthToken {
    policy_id: #"77777777777777777777777777777777777777777777777777777777",
    name: #"01",
  }

const module_token =
  AuthToken {
    policy_id: #"88888888888888888888888888888888888888888888888888888888",
    name: #"02",
  }

const other_port_token =
  AuthToken {
    policy_id: #"89898989898989898989898989898989898989898989898989898989",
    name: #"03",
  }

const other_module_token =
  AuthToken {
    policy_id: #"90909090909090909090909090909090909090909090909090909090",
    name: #"04",
  }

const host_ref =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 0,
  }

const module_ref =
  OutputReference {
    transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    output_index: 0,
  }

const other_module_ref =
  OutputReference {
    transaction_id: #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    output_index: 0,
  }

fn registration() -> ModuleRegistration {
  ModuleRegistration { module_script_hash, port_token, module_token }
}

fn host_input() -> Input {
  Input(
    host_ref,
    Output {
      address: Address(Script(host_script_hash), None),
      value: from_asset(host_policy, host_state_token_name, 1),
      datum: InlineDatum(
        HostStateDatum {
          state: HostState {
            version: 2,
            ibc_state_root: #"0000000000000000000000000000000000000000000000000000000000000000",
            next_client_sequence: 0,
            next_connection_sequence: 0,
            next_channel_sequence: 0,
            bound_port: [Pair(port_id, registration())],
            last_update_time: 5_000,
            live_client_count: 0,
            live_connection_count: 0,
            live_channel_count: 0,
          },
          nft_policy: host_policy,
          deployer,
          shutdown: ShuttingDown {
            initiated_at: 1_000,
            grace_period_end: 5_000,
          },
        },
      ),
      reference_script: None,
    },
  )
}

fn module_value() {
  from_asset(port_token.policy_id, port_token.name, 1)
    |> add(module_token.policy_id, module_token.name, 1)
    |> add(ada_policy_id, ada_asset_name, 3_000_000)
}

fn transfer_root_output(datum: TransferModuleDatum) -> Output {
  Output {
    address: Address(Script(module_script_hash), None),
    value: module_value(),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn settled_transfer_datum() -> TransferModuleDatum {
  TransferModuleDatum {
    escrow_shard_registry_root: empty_escrow_shard_registry_root,
    live_escrow_shard_count: 0,
    voucher_supply: 0,
  }
}

fn host_output() -> Output {
  let input = host_input().output
  expect InlineDatum(raw_datum) = input.datum
  expect input_datum: HostStateDatum = raw_datum
  Output {
    ..input,
    value: input.value
      |> add(lifecycle_policy, lifecycle_marker_token_name, 1),
    datum: InlineDatum(
      HostStateDatum {
        ..input_datum,
        state: HostState {
          ..input_datum.state,
          version: input_datum.state.version + 1,
          bound_port: [Pair(retired_port_marker(port_id), registration())],
          last_update_time: input_datum.state.last_update_time + 1,
        },
      },
    ),
  }
}

fn payout(value) -> Output {
  Output {
    address: from_verification_key(deployer),
    value,
    datum: NoDatum,
    reference_script: None,
  }
}

fn module_reclaim_transaction(
  module_input: Input,
  outputs: List<Output>,
) -> Transaction {
  let host_redeemer: Redeemer = ReclaimModule { port_id }
  let module_redeemer: Redeemer = Callback(OnHostStateSeal)
  let marker_redeemer: Redeemer =
    AuthorizeTransferModuleReclaim { port_id, port_token, module_token }
  Transaction {
    ..transaction.placeholder,
    inputs: [host_input(), module_input],
    outputs,
    mint: from_asset(lifecycle_policy, lifecycle_marker_token_name, 1),
    redeemers: [
      Pair(Spend(host_ref), host_redeemer),
      Pair(Spend(module_input.output_reference), module_redeemer),
      Pair(Mint(lifecycle_policy), marker_redeemer),
    ],
  }
}

fn run_transfer(module_input: Input, outputs: List<Output>) -> Bool {
  let transaction = module_reclaim_transaction(module_input, outputs)
  let marker_redeemer =
    AuthorizeTransferModuleReclaim { port_id, port_token, module_token }
  and {
    spending_transfer_module.spend_transfer_module.spend(
      port_token,
      module_token,
      port_id,
      shard_policy,
      channel_policy,
      voucher_policy,
      host_policy,
      lifecycle_policy,
      None,
      Callback(OnHostStateSeal),
      module_input.output_reference,
      transaction,
    )?,
    minting_lifecycle_marker.mint_lifecycle_marker.mint(
      host_policy,
      "unused client policy",
      "unused connection policy",
      channel_policy,
      marker_redeemer,
      lifecycle_policy,
      transaction,
    )?,
  }
}

fn run_mock(module_input: Input, outputs: List<Output>) -> Bool {
  spending_mock_module.spend_mock_module.spend(
    host_policy,
    None,
    Callback(OnHostStateSeal),
    module_input.output_reference,
    module_reclaim_transaction(module_input, outputs),
  )
}

test transfer_module_reclaim_pays_settled_root_to_deployer() {
  let module_output = transfer_root_output(settled_transfer_datum())
  let module_input = Input(module_ref, module_output)
  run_transfer(module_input, [host_output(), payout(module_output.value)])
}

test transfer_module_reclaim_rejects_live_escrow_shards() fail {
  let module_output =
    transfer_root_output(
      TransferModuleDatum {
        ..settled_transfer_datum(),
        live_escrow_shard_count: 1,
      },
    )
  run_transfer(
    Input(module_ref, module_output),
    [host_output(), payout(module_output.value)],
  )
}

test transfer_module_reclaim_rejects_live_voucher_supply() fail {
  let module_output =
    transfer_root_output(
      TransferModuleDatum { ..settled_transfer_datum(), voucher_supply: 1 },
    )
  run_transfer(
    Input(module_ref, module_output),
    [host_output(), payout(module_output.value)],
  )
}

test transfer_module_reclaim_rejects_omitted_module_payout() fail {
  let module_output = transfer_root_output(settled_transfer_datum())
  run_transfer(Input(module_ref, module_output), [host_output()])
}

test transfer_module_reclaim_rejects_module_script_continuation() fail {
  let module_output = transfer_root_output(settled_transfer_datum())
  run_transfer(
    Input(module_ref, module_output),
    [host_output(), module_output, payout(module_output.value)],
  )
}

test transfer_module_reclaim_rejects_wrong_payout_target() fail {
  let module_output = transfer_root_output(settled_transfer_datum())
  let wrong_payout =
    Output {
      ..payout(module_output.value),
      address: from_verification_key(
        #"99999999999999999999999999999999999999999999999999999999",
      ),
    }
  run_transfer(Input(module_ref, module_output), [host_output(), wrong_payout])
}

test transfer_module_reclaim_rejects_wrong_payout_value() fail {
  let module_output = transfer_root_output(settled_transfer_datum())
  run_transfer(
    Input(module_ref, module_output),
    [
      host_output(),
      payout(module_output.value |> add(ada_policy_id, ada_asset_name, -1)),
    ],
  )
}

test transfer_module_reclaim_rejects_wrong_capability_tokens() fail {
  let module_output = transfer_root_output(settled_transfer_datum())
  let wrong_value =
    from_asset(port_token.policy_id, port_token.name, 1)
      |> add(module_token.policy_id, #"03", 1)
      |> add(ada_policy_id, ada_asset_name, 3_000_000)
  run_transfer(
    Input(module_ref, module_output),
    [host_output(), payout(wrong_value)],
  )
}

test transfer_module_reclaim_rejects_shard_masquerading_as_module_root() fail {
  let shard_output =
    Output {
      ..transfer_root_output(settled_transfer_datum()),
      value: from_asset(shard_policy, #"dead", 1)
        |> add(ada_policy_id, ada_asset_name, 3_000_000),
    }
  run_transfer(
    Input(module_ref, shard_output),
    [host_output(), payout(shard_output.value)],
  )
}

test transfer_module_reclaim_marker_cannot_authorize_second_root() fail {
  let selected_output = transfer_root_output(settled_transfer_datum())
  let selected_input = Input(module_ref, selected_output)
  let other_output =
    Output {
      ..selected_output,
      value: from_asset(other_port_token.policy_id, other_port_token.name, 1)
        |> add(other_module_token.policy_id, other_module_token.name, 1)
        |> add(ada_policy_id, ada_asset_name, 3_000_000),
    }
  let other_input = Input(other_module_ref, other_output)
  let host_redeemer: Redeemer = ReclaimModule { port_id }
  let callback: Redeemer = Callback(OnHostStateSeal)
  let marker_redeemer =
    AuthorizeTransferModuleReclaim { port_id, port_token, module_token }
  let marker_redeemer_data: Redeemer = marker_redeemer
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [host_input(), selected_input, other_input],
      outputs: [
        host_output(),
        payout(selected_output.value),
        payout(other_output.value),
      ],
      mint: from_asset(lifecycle_policy, lifecycle_marker_token_name, 1),
      redeemers: [
        Pair(Spend(host_ref), host_redeemer),
        Pair(Spend(module_ref), callback),
        Pair(Spend(other_module_ref), callback),
        Pair(Mint(lifecycle_policy), marker_redeemer_data),
      ],
    }

  and {
    minting_lifecycle_marker.mint_lifecycle_marker.mint(
      host_policy,
      "unused client policy",
      "unused connection policy",
      channel_policy,
      marker_redeemer,
      lifecycle_policy,
      transaction,
    )?,
    spending_transfer_module.spend_transfer_module.spend(
      other_port_token,
      other_module_token,
      "other-transfer",
      shard_policy,
      channel_policy,
      voucher_policy,
      host_policy,
      lifecycle_policy,
      None,
      Callback(OnHostStateSeal),
      other_module_ref,
      transaction,
    )?,
  }
}

test mock_module_reclaim_pays_true_registered_root_to_deployer() {
  let module_output =
    Output { ..transfer_root_output(settled_transfer_datum()), datum: NoDatum }
  run_mock(
    Input(module_ref, module_output),
    [host_output(), payout(module_output.value)],
  )
}
