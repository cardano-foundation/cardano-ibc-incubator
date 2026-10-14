use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{ChannelState}
use ibc/core/ics_004/types/upgrade.{ErrorReceipt, Upgrade, UpgradeFields}

pub type MintChannelRedeemer {
  ChanOpenInit
  ChanOpenTry {
    counterparty_version: ByteArray,
    proof_init: Data,
    proof_height: Height,
  }
}

pub type SpendChannelRedeemer {
  ChanOpenAck {
    counterparty_version: ByteArray,
    proof_try: Data,
    proof_height: Height,
  }
  ChanOpenConfirm { proof_ack: Data, proof_height: Height }
  RecvPacket { packet: Packet, proof_commitment: Data, proof_height: Height }
  TimeoutPacket {
    packet: Packet,
    proof_unreceived: Data,
    proof_height: Height,
    next_sequence_recv: Int,
  }
  AcknowledgePacket {
    packet: Packet,
    acknowledgement: ByteArray,
    proof_acked: Data,
    proof_height: Height,
  }
  SendPacket { packet: Packet }
  ChanCloseInit
  ChanCloseConfirm { proof_init: Data, proof_height: Height }
  PrunePacketHistory {
    sequence: Int,
    proof_commitment_absence: Data,
    proof_height: Height,
  }
  TimeoutOnClose {
    packet: Packet,
    proof_unreceived: Data,
    proof_close: Data,
    proof_height: Height,
    next_sequence_recv: Int,
  }
  ReclaimChannel
  /// An ICS-04 channel-upgrade step, a `ChannelUpgradeRedeemer`. Only the
  /// upgrade operation decodes it, so other channel validators stay small.
  ChanUpgrade(Data)
}

pub type ChannelUpgradeRedeemer {
  step: ChannelUpgradeStep,
  // Sibling hashes for the `channelEnds/ports/{portId}/channels/{channelId}` key update.
  channel_siblings: List<ByteArray>,
  // Sibling hashes for the `channelUpgrades/upgrades/ports/{portId}/channels/{channelId}` key update.
  upgrade_siblings: List<ByteArray>,
  // Sibling hashes for the `channelUpgrades/upgradeError/ports/{portId}/channels/{channelId}` key update.
  error_receipt_siblings: List<ByteArray>,
}

/// Constructor order is part of the redeemer ABI.
pub type ChannelUpgradeStep {
  /// The deployment authority proposes new channel parameters.
  InitUpgrade { fields: UpgradeFields, timeout_period: Int }
  /// Answers a counterparty proposal that crosses this end's own proposal.
  TryUpgrade {
    counterparty_upgrade_fields: UpgradeFields,
    counterparty_upgrade_sequence: Int,
    proof_channel: Data,
    proof_upgrade: Data,
    proof_height: Height,
  }
  AckUpgrade {
    counterparty_upgrade: Upgrade,
    proof_channel: Data,
    proof_upgrade: Data,
    proof_height: Height,
  }
  ConfirmUpgrade {
    counterparty_channel_state: ChannelState,
    counterparty_upgrade: Upgrade,
    proof_channel: Data,
    proof_upgrade: Data,
    proof_height: Height,
  }
  OpenUpgrade {
    counterparty_upgrade_sequence: Int,
    proof_channel: Data,
    proof_height: Height,
  }
  TimeoutUpgrade {
    counterparty_channel: Channel,
    proof_channel: Data,
    proof_height: Height,
  }
  /// Without an error receipt, only the deployment authority may cancel.
  CancelUpgrade {
    error_receipt: Option<ErrorReceipt>,
    proof_error_receipt: Data,
    proof_height: Height,
  }
  /// Records that the next `lanes` packet lanes have no commitments.
  FlushUpgrade { lanes: Int }
}
