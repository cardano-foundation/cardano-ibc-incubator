use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/apps/transfer/packet_batch.{
  Acknowledge, SendBatch, Timeout, TransferIntent,
}
use ibc/utils/validator_utils

pub type GuardAction {
  IntentSend
  IntentCancel
  Sequence
  Lane
}

validator packet_lane_guard(batch_policy: PolicyId) {
  spend(
    _datum: Option<Data>,
    action: GuardAction,
    ref: OutputReference,
    transaction: Transaction,
  ) {
    when action is {
      IntentCancel -> {
        let input = packet_batch.input_at(transaction, ref)
        expect intent: TransferIntent =
          validator_utils.get_inline_datum(input.output)
        list.has(transaction.extra_signatories, intent.owner)
      }
      _ ->
        when packet_batch.operation(transaction, batch_policy) is {
          SendBatch { sequencer_ref, intents, lanes, .. } ->
            when action is {
              IntentSend -> list.has(intents, ref)
              Sequence -> sequencer_ref == ref
              Lane -> list.any(lanes, fn(lane) { lane.input_ref == ref })
              _ -> False
            }
          Acknowledge { lane, .. } | Timeout { lane, .. } ->
            action == Lane && lane.input_ref == ref
          _ -> False
        }
    }
  }

  else(_) {
    fail
  }
}
