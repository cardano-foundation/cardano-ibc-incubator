use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/order.{Order}

// ICS-04 channel upgrade records committed into the HostState root. Their CBOR
// is fixed by tests/ibc-state-commitment/channel-upgrade.json because deployed
// counterparty light clients authenticate these exact encodings.

/// Channel parameters an upgrade may change.
pub type UpgradeFields {
  ordering: Order,
  connection_hops: List<ByteArray>,
  version: ByteArray,
}

/// Counterparty height or timestamp (nanoseconds) at which the upgrade times
/// out. A zero height or timestamp sets no bound.
pub type UpgradeTimeout {
  height: Height,
  timestamp: Int,
}

/// The upgrade proposed by a channel end, committed under
/// `channelUpgrades/upgrades/ports/{portId}/channels/{channelId}`.
/// The timeout and next_sequence_send stay zero until the end starts flushing.
pub type Upgrade {
  fields: UpgradeFields,
  timeout: UpgradeTimeout,
  next_sequence_send: Int,
}

/// The latest failed upgrade, committed under
/// `channelUpgrades/upgradeError/ports/{portId}/channels/{channelId}`.
pub type ErrorReceipt {
  sequence: Int,
  message: ByteArray,
}
