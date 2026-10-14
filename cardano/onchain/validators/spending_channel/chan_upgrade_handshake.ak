use aiken/math
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_upgrade_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_002_client_semantics/verify_proof_redeemer.{
  BatchVerifyMembership,
}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_004/channel_datum.{
  ChannelDatum, ChannelUpgradeState, PendingUpgrade,
}
use ibc/core/ics_004/channel_upgrade.{
  AckStep, ConfirmStep, Context, Params, TryStep,
} as rules
use ibc/core/ics_004/packet_config.{PacketConfig}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/state.{ChannelState, FlushComplete, Flushing, Open}
use ibc/core/ics_004/types/upgrade.{Upgrade}

// TRY, ACK and CONFIRM of a transfer-channel upgrade, which prove the
// counterparty's channel and upgrade. See ibc/core/ics_004/channel_upgrade.

validator chan_upgrade_handshake(
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
  expect Some(pending) = context.upgrade.pending
  let config = rules.packet_config(context)
  when index is {
    // TRY answers a counterparty proposal that crosses this end's own.
    1 -> {
      expect step: TryStep = data
      expect channel.state == Open
      expect pending.upgrade.next_sequence_send == 0
      expect step.counterparty_upgrade_sequence >= channel.upgrade_sequence
      let connection = rules.current_connection(context)
      let replacement =
        rules.replacement_connection(context, pending.upgrade.fields)
      expect
        rules.compatible(
          pending.upgrade.fields,
          step.counterparty_upgrade_fields,
          replacement,
        )
      let policy =
        verify_channel_and_upgrade(
          context,
          connection,
          step.proof_height,
          step.proof_channel,
          rules.counterparty_channel(
            context,
            Open,
            channel.ordering,
            channel.version,
            connection.counterparty.connection_id,
            step.counterparty_upgrade_sequence,
          ),
          step.proof_upgrade,
          Upgrade {
            fields: step.counterparty_upgrade_fields,
            timeout: rules.no_timeout(),
            next_sequence_send: 0,
          },
        )
      (
        rules.successor(
          context,
          Channel {
            ..channel,
            state: Flushing,
            upgrade_sequence: math.max(
              channel.upgrade_sequence,
              step.counterparty_upgrade_sequence,
            ),
          },
          ChannelUpgradeState {
            ..context.upgrade,
            pending: Some(rules.start_flushing(context, config, pending)),
          },
        ),
        Some(policy),
      )
    }
    2 -> {
      expect step: AckStep = data
      let pending =
        when channel.state is {
          Open -> {
            expect pending.upgrade.next_sequence_send == 0
            rules.start_flushing(context, config, pending)
          }
          Flushing -> pending
          _ -> fail
        }
      counterparty_upgrade_step(
        context,
        config,
        pending,
        Flushing,
        step.counterparty_upgrade,
        step.proof_channel,
        step.proof_upgrade,
        step.proof_height,
      )
    }
    3 -> {
      expect step: ConfirmStep = data
      expect channel.state == Flushing
      expect
        step.counterparty_channel_state == Flushing || step.counterparty_channel_state == FlushComplete
      counterparty_upgrade_step(
        context,
        config,
        pending,
        step.counterparty_channel_state,
        step.counterparty_upgrade,
        step.proof_channel,
        step.proof_upgrade,
        step.proof_height,
      )
    }
    _ -> fail
  }
}

fn verify_channel_and_upgrade(
  context: Context,
  connection: ConnectionEnd,
  proof_height: Height,
  proof_channel: Data,
  counterparty_channel: Channel,
  proof_upgrade: Data,
  counterparty_upgrade: Upgrade,
) -> PolicyId {
  let (client, policy) = rules.proof_client(context, connection, proof_height)
  expect
    rules.require_proof(
      context,
      policy,
      BatchVerifyMembership(
        [
          rules.membership(
            client,
            connection,
            proof_height,
            proof_channel,
            rules.counterparty_channel_path(context),
            rules.channel_value(counterparty_channel),
          ),
          rules.membership(
            client,
            connection,
            proof_height,
            proof_upgrade,
            rules.counterparty_upgrade_path(context),
            channel_upgrade_pb.marshal_upgrade(counterparty_upgrade),
          ),
        ],
      ),
    )
  policy
}

/// ACK and CONFIRM prove the counterparty's flushing channel at this end's
/// sequence and its complete upgrade. The upgrade must be compatible and not
/// yet timed out on this chain.
fn counterparty_upgrade_step(
  context: Context,
  config: PacketConfig,
  pending: PendingUpgrade,
  counterparty_state: ChannelState,
  counterparty_upgrade: Upgrade,
  proof_channel: Data,
  proof_upgrade: Data,
  proof_height: Height,
) -> (ChannelDatum, Option<PolicyId>) {
  expect None = pending.counterparty_upgrade
  let channel = context.datum.state.channel
  let connection = rules.current_connection(context)
  let replacement =
    rules.replacement_connection(context, pending.upgrade.fields)
  expect
    rules.compatible(
      pending.upgrade.fields,
      counterparty_upgrade.fields,
      replacement,
    )
  let timeout = counterparty_upgrade.timeout
  expect height_mod.is_zero(timeout.height)
  expect timeout.timestamp > rules.valid_to(context) * 1_000_000
  let policy =
    verify_channel_and_upgrade(
      context,
      connection,
      proof_height,
      proof_channel,
      rules.counterparty_channel(
        context,
        counterparty_state,
        channel.ordering,
        channel.version,
        connection.counterparty.connection_id,
        channel.upgrade_sequence,
      ),
      proof_upgrade,
      counterparty_upgrade,
    )
  let pending =
    PendingUpgrade {
      ..pending,
      counterparty_upgrade: Some(counterparty_upgrade),
    }
  let state =
    if pending.flushed_lanes == config.lane_count {
      FlushComplete
    } else {
      Flushing
    }
  (
    rules.successor(
      context,
      Channel { ..channel, state },
      ChannelUpgradeState { ..context.upgrade, pending: Some(pending) },
    ),
    Some(policy),
  )
}
