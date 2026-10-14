use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_upgrade_pb
use ibc/core/ics_002_client_semantics/client_view
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelUpgradeState, PendingUpgrade,
}
use ibc/core/ics_004/channel_upgrade.{
  CancelStep, Context, OpenStep, Params, TimeoutStep,
} as rules
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/state.{FlushComplete, Flushing, Open}
use ibc/core/ics_004/types/upgrade.{Upgrade}

// OPEN, TIMEOUT and CANCEL of a transfer-channel upgrade, which open the
// upgraded channel or restore it. See ibc/core/ics_004/channel_upgrade.

validator chan_upgrade_finish(
  client_registry: Data,
  connection_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  packet_config_policy_id: PolicyId,
) {
  mint(channel_token: AuthToken, policy_id: PolicyId, transaction: Transaction) {
    rules.validate(
      Params {
        client_registry,
        connection_policy: connection_minting_policy_id,
        verify_proof_policy: verify_proof_policy_id,
        host_state_nft_policy: host_state_nft_policy_id,
        packet_config_policy: packet_config_policy_id,
      },
      channel_token,
      policy_id,
      transaction,
      transition,
    )
  }

  else(_) {
    fail
  }
}

fn transition(
  context: Context,
  index: Int,
  data: Data,
) -> (ChannelDatum, Option<PolicyId>) {
  let channel = context.datum.state.channel
  let upgrade = context.upgrade
  when index is {
    4 -> {
      expect step: OpenStep = data
      expect channel.state == FlushComplete
      expect Some(pending) = upgrade.pending
      expect Some(counterparty_upgrade) = pending.counterparty_upgrade
      expect step.counterparty_upgrade_sequence >= channel.upgrade_sequence
      let fields = pending.upgrade.fields
      let replacement = rules.replacement_connection(context, fields)
      let connection = rules.current_connection(context)
      let (client, policy) =
        rules.proof_client(context, connection, step.proof_height)
      expect
        rules.require_proof(
          context,
          policy,
          rules.single(
            rules.membership(
              client,
              connection,
              step.proof_height,
              step.proof_channel,
              rules.counterparty_channel_path(context),
              rules.channel_value(
                rules.counterparty_channel(
                  context,
                  Open,
                  fields.ordering,
                  fields.version,
                  replacement.counterparty.connection_id,
                  step.counterparty_upgrade_sequence,
                ),
              ),
            ),
          ),
        )
      (
        rules.successor(
          context,
          Channel {
            ..channel,
            state: Open,
            ordering: fields.ordering,
            connection_hops: fields.connection_hops,
            version: fields.version,
          },
          ChannelUpgradeState {
            ..upgrade,
            pending: None,
            recv_start_sequence: counterparty_upgrade.next_sequence_send,
          },
        ),
        Some(policy),
      )
    }

    5 -> {
      expect step: TimeoutStep = data
      let counterparty_channel = step.counterparty_channel
      expect channel.state == Flushing || channel.state == FlushComplete
      expect Some(pending) = upgrade.pending
      let fields = pending.upgrade.fields
      let connection = rules.current_connection(context)
      let (client, policy) =
        rules.proof_client(context, connection, step.proof_height)
      expect Some(timestamp) =
        client_view.timestamp_at_height(client, step.proof_height)
      let timeout = pending.upgrade.timeout.timestamp
      expect timeout > 0 && timestamp >= timeout
      expect
        counterparty_channel.state == Open || counterparty_channel.state == Flushing
      expect counterparty_channel.upgrade_sequence >= channel.upgrade_sequence
      // Unlike ibc-go v8.7.0, compare the counterparty's own hop to decide
      // whether it already opened with this upgrade.
      let replacement =
        rules.referred_connection(
          context,
          rules.single_hop(fields.connection_hops),
        )
      expect
        counterparty_channel.state != Open || counterparty_channel.ordering != fields.ordering || counterparty_channel.version != fields.version || counterparty_channel.connection_hops != [
          replacement.counterparty.connection_id,
        ]
      expect
        rules.require_proof(
          context,
          policy,
          rules.single(
            rules.membership(
              client,
              connection,
              step.proof_height,
              step.proof_channel,
              rules.counterparty_channel_path(context),
              rules.channel_value(counterparty_channel),
            ),
          ),
        )
      (
        rules.restore(context, channel.upgrade_sequence, rules.upgrade_timeout),
        Some(policy),
      )
    }

    6 -> {
      expect step: CancelStep = data
      expect Some(_) = upgrade.pending
      when step.error_receipt is {
        // The authority can cancel until this end finished flushing.
        None -> {
          expect rules.authorized(context)
          expect channel.state != FlushComplete
          (
            rules.restore(
              context,
              channel.upgrade_sequence,
              rules.invalid_upgrade,
            ),
            None,
          )
        }
        // The counterparty restored its end and committed this receipt.
        Some(receipt) -> {
          expect receipt.sequence >= channel.upgrade_sequence
          expect
            channel.state != FlushComplete || receipt.sequence == channel.upgrade_sequence
          let connection = rules.current_connection(context)
          let (client, policy) =
            rules.proof_client(context, connection, step.proof_height)
          expect
            rules.require_proof(
              context,
              policy,
              rules.single(
                rules.membership(
                  client,
                  connection,
                  step.proof_height,
                  step.proof_error_receipt,
                  rules.counterparty_error_receipt_path(context),
                  channel_upgrade_pb.marshal_error_receipt(receipt),
                ),
              ),
            )
          (
            rules.restore(context, receipt.sequence, rules.invalid_upgrade),
            Some(policy),
          )
        }
      }
    }

    _ -> fail
  }
}
