use aiken/collection/list
use aiken/collection/pairs
use cardano/address as address
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleCallback, IBCModuleOperator, IBCModulePacketData,
  IBCModuleRedeemer, ModuleDataV1, ModuleOperatorV1, OnAcknowledgementPacket,
  OnChanCloseConfirm, OnChanCloseInit, OnChanOpenAck, OnChanOpenConfirm,
  OnChanOpenInit, OnChanOpenTry, OnChanReclaim, OnHostStateSeal, OnRecvPacket,
  OnSendPacket, OnTimeoutPacket, Operator, OtherModuleData, OtherModuleOperator,
}
use ibc/utils/validator_utils

pub type MockModulePacketData {
  MockModulePacketData { packet_data: ByteArray }
}

pub type MockModuleOperator {
  MockNoOp
}

validator spend_mock_module(host_state_nft_policy_id: PolicyId) {
  spend(
    _datum: Option<Data>,
    redeemer: IBCModuleRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    when redeemer is {
      Callback(OnHostStateSeal) ->
        validate_terminal_module_reclaim(
          spent_output_ref,
          transaction,
          host_state_nft_policy_id,
        )
      _ -> {
        let Transaction { inputs, outputs, .. } = transaction

        // A generic module witness is only meaningful as part of an authenticated
        // IBC state transition. Requiring the HostState thread prevents standalone
        // spends from removing a registered module's capability tokens.
        let (host_state_input, _) =
          validator_utils.require_host_state_thread(
            inputs,
            outputs,
            host_state_nft_policy_id,
          )
        expect InlineDatum(_) = host_state_input.output.datum

        expect Some(spent_input) =
          transaction.find_input(inputs, spent_output_ref)
        // One byte-identical continuation prevents moving, splitting, or mutating the registered module witness.
        expect [continuing_output] =
          list.filter(
            outputs,
            fn(output) {
              output_is_exact_continuation(output, spent_input.output)
            },
          )

        and {
          output_is_exact_continuation(continuing_output, spent_input.output),
          when redeemer is {
            Callback(callback) -> validate_callback(callback, host_state_input)
            Operator(operator) -> validate_operator(operator)
          },
        }
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_terminal_module_reclaim(
  spent_output_ref: OutputReference,
  transaction: Transaction,
  host_state_nft_policy_id: PolicyId,
) -> Bool {
  let Transaction { inputs, outputs, redeemers, .. } = transaction
  let (host_input, _, port_id) =
    validator_utils.require_host_state_module_reclaim(
      inputs,
      outputs,
      redeemers,
      host_state_nft_policy_id,
    )
  let host_datum = validator_utils.get_host_state_datum(host_input)
  expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
  expect Some(registration) =
    pairs.get_first(host_datum.state.bound_port, port_id)
  expect address.Script(actual_script_hash) =
    spent_input.output.address.payment_credential

  and {
    actual_script_hash == registration.module_script_hash,
    validator_utils.validate_terminal_module_root_payout(
      spent_input.output,
      outputs,
      registration.port_token,
      registration.module_token,
      host_datum.deployer,
    ),
  }
}

fn output_is_exact_continuation(output: Output, spent_output: Output) -> Bool {
  and {
    output.address == spent_output.address,
    output.value == spent_output.value,
    output.datum == spent_output.datum,
    output.reference_script == spent_output.reference_script,
  }
}

fn validate_callback(
  callback: IBCModuleCallback,
  host_state_input: Input,
) -> Bool {
  when callback is {
    OnRecvPacket { packet_data, data, .. } ->
      validate_packet_data(packet_data, data)
    OnSendPacket { packet_data, data, .. } -> {
      // Generic module sends create new packet commitments, so stop accepting
      // them once deployment shutdown begins. Drain callbacks remain available.
      expect _ = validator_utils.require_active_host_state(host_state_input)
      validate_packet_data(packet_data, data)
    }
    OnTimeoutPacket { packet_data, data, .. } ->
      validate_packet_data(packet_data, data)
    OnAcknowledgementPacket { packet_data, data, .. } ->
      validate_packet_data(packet_data, data)
    OnChanOpenInit { .. } -> True
    OnChanOpenTry { .. } -> True
    OnChanOpenAck { .. } -> True
    OnChanOpenConfirm { .. } -> True
    OnChanCloseInit { .. } -> True
    OnChanCloseConfirm { .. } -> True
    OnChanReclaim { .. } -> True
    OnHostStateSeal -> False
  }
}

// The Other* constructors are legacy no-payload/no-op sentinels retained unchanged for wire compatibility.
fn validate_packet_data(
  packet_data: ByteArray,
  module_data: IBCModulePacketData,
) -> Bool {
  when module_data is {
    OtherModuleData -> True
    ModuleDataV1(data) -> {
      expect mock_data: MockModulePacketData = data
      mock_data.packet_data == packet_data
    }
  }
}

fn validate_operator(operator: IBCModuleOperator) -> Bool {
  when operator is {
    OtherModuleOperator -> True
    ModuleOperatorV1(data) -> {
      expect mock_operator: MockModuleOperator = data
      mock_operator == MockNoOp
    }
  }
}
