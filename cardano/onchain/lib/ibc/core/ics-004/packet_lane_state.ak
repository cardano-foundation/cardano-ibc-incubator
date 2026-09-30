use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_lane_datum.{LaneUpdate, PacketLaneDatum}
use ibc/core/ics_004/packet_lanes
use ibc/utils/validator_utils

/// State-thread validation for the packet operation validators. This checks
/// identity, unique continuation and exact roots. It does not authorize a
/// packet operation or replace its application and counterparty proof checks.
pub fn validate_transition(
  transaction: Transaction,
  spent_ref: OutputReference,
  lane_policy: PolicyId,
  updates: List<LaneUpdate>,
) -> Bool {
  validate_transition_with_balances(
    transaction,
    spent_ref,
    lane_policy,
    updates,
    fn(old) { old.balances },
  )
}

pub fn validate_transition_with_balances(
  transaction: Transaction,
  spent_ref: OutputReference,
  lane_policy: PolicyId,
  updates: List<LaneUpdate>,
  update_balances: fn(PacketLaneDatum) -> Pairs<ByteArray, Int>,
) -> Bool {
  expect Some(input) = transaction.find_input(transaction.inputs, spent_ref)
  expect old: PacketLaneDatum = validator_utils.get_inline_datum(input.output)
  let token =
    AuthToken {
      policy_id: lane_policy,
      name: packet_lanes.lane_token_name(
        old.port_id,
        old.channel_id,
        old.lane,
        old.lane_count,
      ),
    }
  expect auth.contain_auth_token(input.output, token)
  expect [unique_input] =
    list.filter(
      transaction.inputs,
      fn(candidate) { auth.contain_auth_token(candidate.output, token) },
    )
  expect unique_input.output_reference == spent_ref
  expect assets.quantity_of(transaction.mint, token.policy_id, token.name) == 0
  let output =
    validator_utils.find_unique_continuation_output(
      input.output,
      transaction.outputs,
      token,
    )
  expect new: PacketLaneDatum = validator_utils.get_inline_datum(output)
  let expected = packet_lane_datum.apply_updates(old, updates)
  new == PacketLaneDatum { ..expected, balances: update_balances(old) }
}
