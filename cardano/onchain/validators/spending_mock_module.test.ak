use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, ModuleDataV1, ModuleOperatorV1,
  OnAcknowledgementPacket, OnRecvPacket, OnSendPacket, OnTimeoutPacket, Operator,
  OtherModuleData,
}
use ibc/core/ics_025_handler_interface/host_state.{
  Active, HostState, HostStateDatum, ShutdownState, ShuttingDown,
  empty_ibc_state_root, host_state_token_name,
}
use spending_mock_module.{MockModulePacketData, MockNoOp}

type ForeignModulePacketData {
  ForeignModulePacketData { value: Int, version: Int }
}

const host_state_output_reference =
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: 0,
  }

const module_output_reference =
  OutputReference {
    transaction_id: #"2222222222222222222222222222222222222222222222222222222222222222",
    output_index: 0,
  }

fn host_state_nft_policy_id() -> PolicyId {
  "mock host state nft policy id"
}

fn host_state_datum(shutdown: ShutdownState) -> HostStateDatum {
  HostStateDatum {
    state: HostState {
      version: 0,
      ibc_state_root: empty_ibc_state_root,
      next_client_sequence: 0,
      next_connection_sequence: 0,
      next_channel_sequence: 0,
      bound_port: [],
      last_update_time: 0,
      live_client_count: 0,
      live_connection_count: 0,
      live_channel_count: 0,
    },
    nft_policy: host_state_nft_policy_id(),
    deployer: #"00000000000000000000000000000000000000000000000000000000",
    shutdown,
    live_reference_script_count: Some(0),
    reference_script_inventory_root: empty_ibc_state_root,
    reference_script_registration: None,
  }
}

fn host_state_output_with_shutdown(shutdown: ShutdownState) -> Output {
  Output {
    address: from_script("mock host state script hash"),
    value: from_asset(host_state_nft_policy_id(), host_state_token_name, 1),
    datum: InlineDatum(host_state_datum(shutdown)),
    reference_script: None,
  }
}

fn host_state_output() -> Output {
  host_state_output_with_shutdown(Active)
}

fn module_output() -> Output {
  Output {
    address: from_script("mock module script hash"),
    value: from_asset("mock module policy id", "mock module token", 1),
    datum: NoDatum,
    reference_script: None,
  }
}

fn module_input() -> Input {
  Input { output_reference: module_output_reference, output: module_output() }
}

fn transaction_with_shutdown(shutdown: ShutdownState) -> Transaction {
  let host_output = host_state_output_with_shutdown(shutdown)
  let module_output = module_output()
  Transaction {
    ..transaction.placeholder,
    inputs: [
      Input {
        output_reference: host_state_output_reference,
        output: host_output,
      },
      Input { output_reference: module_output_reference, output: module_output },
    ],
    outputs: [host_output, module_output],
  }
}

fn valid_transaction() -> Transaction {
  transaction_with_shutdown(Active)
}

fn shutting_down_transaction() -> Transaction {
  transaction_with_shutdown(
    ShuttingDown { initiated_at: 1_000, grace_period_end: 2_000 },
  )
}

fn run_mock_module(
  redeemer: IBCModuleRedeemer,
  transaction: Transaction,
) -> Bool {
  spending_mock_module.spend_mock_module.spend(
    host_state_nft_policy_id(),
    None,
    redeemer,
    module_output_reference,
    transaction,
  )
}

fn mock_no_op_redeemer() -> IBCModuleRedeemer {
  Operator(ModuleOperatorV1(MockNoOp))
}

test mock_module_decodes_its_own_opaque_packet_data() {
  let packet_data = "generic-packet"

  run_mock_module(
    Callback(
      OnSendPacket {
        channel_id: "channel-0",
        packet_data,
        packet_commitment: "commitment",
        data: ModuleDataV1(MockModulePacketData { packet_data }),
      },
    ),
    valid_transaction(),
  )
}

test mock_module_rejects_new_send_while_host_is_shutting_down() fail {
  let packet_data = "generic-packet"

  run_mock_module(
    Callback(
      OnSendPacket {
        channel_id: "channel-0",
        packet_data,
        packet_commitment: "commitment",
        data: ModuleDataV1(MockModulePacketData { packet_data }),
      },
    ),
    shutting_down_transaction(),
  )
}

test mock_module_allows_receive_drain_while_host_is_shutting_down() {
  let packet_data = "generic-packet"

  run_mock_module(
    Callback(
      OnRecvPacket {
        channel_id: "channel-0",
        packet_data,
        acknowledgement: acknowledgement.new_result_acknowledgement("AQ=="),
        data: ModuleDataV1(MockModulePacketData { packet_data }),
      },
    ),
    shutting_down_transaction(),
  )
}

test mock_module_allows_timeout_drain_while_host_is_shutting_down() {
  let packet_data = "generic-packet"

  run_mock_module(
    Callback(
      OnTimeoutPacket {
        channel_id: "channel-0",
        packet_data,
        data: ModuleDataV1(MockModulePacketData { packet_data }),
      },
    ),
    shutting_down_transaction(),
  )
}

test mock_module_allows_acknowledgement_drain_while_host_is_shutting_down() {
  let packet_data = "generic-packet"

  run_mock_module(
    Callback(
      OnAcknowledgementPacket {
        channel_id: "channel-0",
        packet_data,
        acknowledgement: acknowledgement.new_result_acknowledgement("AQ=="),
        data: ModuleDataV1(MockModulePacketData { packet_data }),
      },
    ),
    shutting_down_transaction(),
  )
}

test mock_module_rejects_a_different_applications_payload_type() fail {
  run_mock_module(
    Callback(
      OnSendPacket {
        channel_id: "channel-0",
        packet_data: "generic-packet",
        packet_commitment: "commitment",
        data: ModuleDataV1(ForeignModulePacketData { value: 42, version: 1 }),
      },
    ),
    valid_transaction(),
  )
}

test mock_module_binds_its_typed_payload_to_the_raw_packet_bytes() fail {
  run_mock_module(
    Callback(
      OnSendPacket {
        channel_id: "channel-0",
        packet_data: "wire-packet",
        packet_commitment: "commitment",
        data: ModuleDataV1(
          MockModulePacketData { packet_data: "different-packet" },
        ),
      },
    ),
    valid_transaction(),
  )
}

test mock_module_retains_the_no_payload_callback_variant() {
  run_mock_module(
    Callback(
      OnSendPacket {
        channel_id: "channel-0",
        packet_data: "generic-packet",
        packet_commitment: "commitment",
        data: OtherModuleData,
      },
    ),
    valid_transaction(),
  )
}

test mock_module_decodes_its_own_opaque_operator() {
  run_mock_module(mock_no_op_redeemer(), valid_transaction())
}

test mock_module_rejects_a_standalone_spend_without_the_host_thread() fail {
  let module_output = module_output()
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [module_input()],
      outputs: [module_output],
    }

  run_mock_module(mock_no_op_redeemer(), transaction)
}

test mock_module_rejects_moving_the_capability_output() fail {
  let valid_transaction = valid_transaction()
  let moved_module_output =
    Output { ..module_output(), address: from_script("attacker script hash") }
  let transaction =
    Transaction {
      ..valid_transaction,
      outputs: [host_state_output(), moved_module_output],
    }

  run_mock_module(mock_no_op_redeemer(), transaction)
}
