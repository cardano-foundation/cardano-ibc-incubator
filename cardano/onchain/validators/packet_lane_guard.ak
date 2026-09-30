use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, OutputReference, Transaction}
use ibc/apps/transfer/packet_accounting
use ibc/apps/transfer/packet_batch.{
  Acknowledge, Prune, Receive, Reject, SendBatch, Timeout, TimeoutOnClose,
  TransferIntent,
}
use ibc/core/ics_004/packet_lane_state
use ibc/utils/validator_utils

pub type GuardAction {
  IntentSend
  IntentCancel
  Sequence
  Lane
  Retire
  CompactBalances { peer_ref: OutputReference }
}

validator packet_lane_guard(batch_policy: PolicyId, lane_policy: PolicyId) {
  spend(
    _datum: Option<Data>,
    action: GuardAction,
    ref: OutputReference,
    transaction: Transaction,
  ) {
    when action is {
      CompactBalances { peer_ref } ->
        packet_lane_state.compact_balances(
          transaction,
          ref,
          peer_ref,
          lane_policy,
        )
      Retire -> {
        let input = packet_batch.input_at(transaction, ref)
        expect assets.tokens(input.output.value, lane_policy) != dict.empty
        list.all(
          dict.to_pairs(assets.tokens(input.output.value, lane_policy)),
          fn(entry) {
            let Pair(name, quantity) = entry
            quantity == 1 && assets.quantity_of(
              transaction.mint,
              lane_policy,
              name,
            ) == -1
          },
        )
      }
      IntentCancel -> {
        let input = packet_batch.input_at(transaction, ref)
        expect intent: TransferIntent =
          validator_utils.get_inline_datum(input.output)
        list.has(transaction.extra_signatories, intent.owner)
      }
      IntentSend | Sequence -> {
        // The minting router validates the complete operation. These inputs
        // only need their position in its send batch, not its Merkle witnesses.
        expect Some(raw) =
          pairs.get_first(transaction.redeemers, Mint(batch_policy))
        let fields = builtin.snd_pair(builtin.un_constr_data(raw))
        expect Some(raw_operation) = list.at(fields, 1)
        let tag = builtin.fst_pair(builtin.un_constr_data(raw_operation))
        let operation_fields =
          builtin.snd_pair(builtin.un_constr_data(raw_operation))
        expect tag == 0
        if action == Sequence {
          expect Some(raw_ref) = list.at(operation_fields, 0)
          expect sequencer_ref: OutputReference = raw_ref
          sequencer_ref == ref
        } else {
          expect Some(raw_intents) = list.at(operation_fields, 1)
          expect intents: List<OutputReference> = raw_intents
          list.has(intents, ref)
        }
      }
      Lane -> {
        let op = packet_batch.operation(transaction, batch_policy)
        when op is {
          SendBatch { lanes, .. } -> {
            expect Some(lane) =
              list.find(lanes, fn(lane) { lane.input_ref == ref })
            packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          }
          Acknowledge { lane, .. } ->
            action == Lane && lane.input_ref == ref && packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          Timeout { lane, .. } ->
            action == Lane && lane.input_ref == ref && packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          TimeoutOnClose { lane, .. } ->
            action == Lane && lane.input_ref == ref && packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          Receive { lane, .. } ->
            action == Lane && lane.input_ref == ref && packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          Reject { lane, .. } ->
            action == Lane && lane.input_ref == ref && packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          Prune { lane, .. } ->
            action == Lane && lane.input_ref == ref && packet_lane_state.validate_transition_with_balances(
              transaction,
              ref,
              lane_policy,
              lane.updates,
              fn(old) { packet_accounting.balance_after(transaction, old, op) },
            )
          _ -> False
        }
      }
    }
  }

  else(_) {
    fail
  }
}
