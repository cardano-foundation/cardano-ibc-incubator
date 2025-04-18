use ibc/apps/transfer/types/keys as transfer_module_keys
use ibc/core/ics_004/types/acknowledgement.{Acknowledgement} as acknowledgement_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Unordered}

pub fn validate_on_chan_open_init(
  order: Order,
  _connection_hops: List<ByteArray>,
  _port_id: ByteArray,
  _channel_id: ByteArray,
  _counterparty: ChannelCounterparty,
  version: ByteArray,
) -> Bool {
  and {
    order == Unordered,
    version == transfer_module_keys.version,
  }
}

pub fn validate_on_chan_open_try(
  order: Order,
  _connection_hops: List<ByteArray>,
  _port_id: ByteArray,
  _channel_id: ByteArray,
  _counterparty: ChannelCounterparty,
  version: ByteArray,
  counterparty_version: ByteArray,
) -> Bool {
  and {
    order == Unordered,
    counterparty_version == transfer_module_keys.version,
    version == transfer_module_keys.version,
  }
}

pub fn validate_on_chan_open_ack(
  _port_id: ByteArray,
  _channel_id: ByteArray,
  _counterparty_channel_id: ByteArray,
  counterparty_version: ByteArray,
) -> Bool {
  counterparty_version == transfer_module_keys.version
}

pub fn validate_on_chan_open_confirm(
  _port_id: ByteArray,
  _channel_id: ByteArray,
) -> Bool {
  True
}

pub fn validate_on_chan_recv_packet(acknowledgement: Acknowledgement) -> Bool {
  acknowledgement == acknowledgement_mod.new_result_acknowledgement("AQ==")
}
