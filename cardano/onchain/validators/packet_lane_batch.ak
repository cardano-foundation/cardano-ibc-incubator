use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/apps/transfer/packet_batch.{
  Acknowledge, BatchOperation, Consolidate, RetireEmpty, SendBatch, Timeout,
}
use ibc/auth.{AuthToken}

// Opt-in native-asset batch path. Deployment/bootstrap and Gateway routing are
// deliberately separate from the existing channel singleton validators.
validator packet_lane_batch(
  channel_token: AuthToken,
  sequencer_token: AuthToken,
  lane_policy: PolicyId,
  client_policy: PolicyId,
  connection_policy: PolicyId,
  lane_count: Int,
) {
  mint(op: BatchOperation, policy: PolicyId, transaction: Transaction) {
    when op is {
      SendBatch { .. } ->
        packet_batch.validate_send(
          transaction,
          policy,
          channel_token,
          sequencer_token,
          lane_policy,
          client_policy,
          connection_policy,
          lane_count,
          op,
        )
      Acknowledge { .. } | Timeout { .. } ->
        packet_batch.validate_settlement(
          transaction,
          policy,
          channel_token,
          lane_policy,
          client_policy,
          connection_policy,
          lane_count,
          op,
        )
      RetireEmpty { .. } | Consolidate { .. } ->
        packet_batch.validate_retirement(transaction, policy, op)
    }
  }

  spend(
    _datum: Option<Data>,
    _redeemer: Void,
    ref: OutputReference,
    transaction: Transaction,
  ) {
    let input = packet_batch.input_at(transaction, ref)
    expect Script(policy) = input.output.address.payment_credential
    when packet_batch.operation(transaction, policy) is {
      Timeout { liquidity_refs, .. } |
      RetireEmpty { liquidity_refs } |
      Consolidate { liquidity_refs, .. } -> list.has(liquidity_refs, ref)
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
