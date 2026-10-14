use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelUpgradeState, PendingUpgrade,
}
use ibc/core/ics_004/channel_upgrade.{Context,
  FlushStep, InitStep, Params} as rules
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/state.{FlushComplete, Flushing, Open}
use ibc/core/ics_004/types/upgrade.{Upgrade}

// INIT and FLUSH of a transfer-channel upgrade, which need no counterparty
// proof. See ibc/core/ics_004/channel_upgrade.

validator chan_upgrade(
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
    0 -> {
      expect step: InitStep = data
      let fields = step.fields
      expect rules.authorized(context)
      expect channel.state == Open
      expect
        step.timeout_period >= rules.min_timeout_period && step.timeout_period <= rules.max_timeout_period
      expect and {
          fields.ordering == channel.ordering,
          fields.version == channel.version,
          fields.connection_hops != channel.connection_hops,
        }
      // As in ibc-go, the replacement connection must be open and support
      // the ordering. Its client is checked when proofs use it.
      let replacement = rules.replacement_connection(context, fields)
      expect [version] = replacement.versions
      expect list.has(version.features, "ORDER_UNORDERED")
      // A new proposal replaces one that has not started flushing.
      let error_receipt =
        when upgrade.pending is {
          Some(_) ->
            rules.next_error_receipt(
              upgrade,
              channel.upgrade_sequence,
              rules.invalid_upgrade,
            )
          None -> upgrade.error_receipt
        }
      (
        rules.successor(
          context,
          Channel { ..channel, upgrade_sequence: channel.upgrade_sequence + 1 },
          ChannelUpgradeState {
            ..upgrade,
            pending: Some(
              PendingUpgrade {
                upgrade: Upgrade {
                  fields,
                  timeout: rules.no_timeout(),
                  next_sequence_send: 0,
                },
                timeout_period: step.timeout_period,
                counterparty_upgrade: None,
                flushed_lanes: 0,
              },
            ),
            error_receipt,
          },
        ),
        None,
      )
    }

    7 -> {
      expect step: FlushStep = data
      expect channel.state == Flushing
      expect Some(pending) = upgrade.pending
      let config = rules.packet_config(context)
      expect step.lanes > 0
      let flushed_lanes = pending.flushed_lanes + step.lanes
      expect flushed_lanes <= config.lane_count
      expect
        list.all(
          list.range(pending.flushed_lanes, flushed_lanes - 1),
          fn(lane) { rules.lane_drained(context, config, lane) },
        )
      let pending = PendingUpgrade { ..pending, flushed_lanes }
      let state =
        if flushed_lanes == config.lane_count && pending.counterparty_upgrade != None {
          FlushComplete
        } else {
          Flushing
        }
      (
        rules.successor(
          context,
          Channel { ..channel, state },
          ChannelUpgradeState { ..upgrade, pending: Some(pending) },
        ),
        None,
      )
    }

    _ -> fail
  }
}
