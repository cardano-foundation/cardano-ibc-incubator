use ibc/core/ics_024_host_requirements/validate

/// ChannelCounterparty defines a channel end counterparty
pub type ChannelCounterparty {
  /// port on the counterparty chain which owns the other end of the channel.
  port_id: ByteArray,
  /// channel end on the counterparty chain
  channel_id: ByteArray,
}

pub fn validate_basic(c: ChannelCounterparty) -> Bool {
  expect validate.port_identifier_validator(c.port_id)

  expect
    c.channel_id == "" || validate.channel_identifier_validator(c.channel_id)

  True
}
