use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/core/ics_004/types/upgrade.{ErrorReceipt, Upgrade}

// Export destination-consumed types into the blueprint even though production
// validators decode them from opaque Data. This validator always fails and is
// not part of a deployment.
validator include_unused_types(
  _packet_lane: PacketLaneDatum,
  _channel_upgrade: Upgrade,
  _error_receipt: ErrorReceipt,
) {
  else(_) {
    fail
  }
}
