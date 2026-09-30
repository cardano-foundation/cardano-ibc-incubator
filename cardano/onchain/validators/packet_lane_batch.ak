use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/apps/transfer/packet_batch.{
  Acknowledge, AuthorizedOperation, Consolidate, Prune, Receive, Reject,
  RetireEmpty, RetireLanes, SendBatch, Timeout, TimeoutOnClose,
}
use ibc/utils/validator_utils

// Canonical transfer packet execution. Channel configuration is read by NFT.
pub type OperationPolicies {
  send: PolicyId,
  acknowledge: PolicyId,
  timeout: PolicyId,
  reject: PolicyId,
  receive: PolicyId,
  prune: PolicyId,
  timeout_on_close: PolicyId,
  retire: PolicyId,
  funds: PolicyId,
  send_funds: PolicyId,
}

validator packet_lane_batch(
  channel_policy: PolicyId,
  policies: OperationPolicies,
) {
  mint(
    authorized: AuthorizedOperation,
    _policy: PolicyId,
    transaction: Transaction,
  ) {
    expect authorized.channel_token.policy_id == channel_policy
    let delegate =
      when authorized.operation is {
        SendBatch { .. } -> policies.send
        Acknowledge { .. } -> policies.acknowledge
        Timeout { .. } -> policies.timeout
        Reject { .. } -> policies.reject
        Receive { .. } -> policies.receive
        Prune { .. } -> policies.prune
        TimeoutOnClose { .. } -> policies.timeout_on_close
        RetireEmpty { .. } | Consolidate { .. } | RetireLanes -> policies.retire
      }
    let funds_policy =
      when authorized.operation is {
        SendBatch { .. } -> policies.send_funds
        _ -> policies.funds
      }
    expect
      when authorized.operation is {
        SendBatch { .. } |
        Acknowledge { .. } |
        Timeout { .. } |
        TimeoutOnClose { .. } |
        Reject { .. } |
        Receive { .. } ->
          validator_utils.require_exact_marker_mint(
            transaction.mint,
            funds_policy,
            "",
            1,
          )
        _ -> True
      }
    validator_utils.require_exact_marker_mint(transaction.mint, delegate, "", 1)
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
      TimeoutOnClose { liquidity_refs, .. } |
      Reject { liquidity_refs, .. } |
      Receive { liquidity_refs, .. } |
      RetireEmpty { liquidity_refs } |
      Consolidate { liquidity_refs, .. } -> list.has(liquidity_refs, ref)
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
