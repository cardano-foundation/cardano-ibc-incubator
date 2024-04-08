use ibc/apps/transfer/ibc_module as transfer_ibc_module
use ibc/apps/transfer/types/keys as transfer_module_keys
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}

//===========================================validate_on_chain_open_init=====================================

test validate_on_chan_open_init_succeed() {
  transfer_ibc_module.validate_on_chan_open_init(
    Unordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    transfer_module_keys.version,
  )
}

test validate_on_chan_open_init_fail_if_ordering_is_not_unordered() fail {
  transfer_ibc_module.validate_on_chan_open_init(
    Ordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    transfer_module_keys.version,
  )
}

test validate_on_chan_open_init_fail_if_version_is_invalid() fail {
  transfer_ibc_module.validate_on_chan_open_init(
    Ordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    "invalid version",
  )
}

//===========================================validate_on_chain_open_try=====================================

test validate_on_chan_open_try_succeed() {
  transfer_ibc_module.validate_on_chan_open_try(
    Unordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    transfer_module_keys.version,
    transfer_module_keys.version,
  )
}

test validate_on_chan_open_try_fail_if_ordering_is_not_unordered() fail {
  transfer_ibc_module.validate_on_chan_open_try(
    Ordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    transfer_module_keys.version,
    transfer_module_keys.version,
  )
}

test validate_on_chan_open_try_fail_if_version_is_invalid() fail {
  transfer_ibc_module.validate_on_chan_open_try(
    Ordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    "invalid version",
    transfer_module_keys.version,
  )
}

test validate_on_chan_open_try_fail_if_counterparty_version_is_invalid() fail {
  transfer_ibc_module.validate_on_chan_open_try(
    Ordered,
    [],
    "port-1",
    "channel-0",
    ChannelCounterparty { port_id: "port-1", channel_id: "channel-0" },
    transfer_module_keys.version,
    "invalid version",
  )
}

//===========================================validate_on_chain_open_ack=====================================

test validate_on_chan_open_ack_succeed() {
  transfer_ibc_module.validate_on_chan_open_ack(
    "port-1",
    "channel-0",
    "channel-10",
    transfer_module_keys.version,
  )
}

test validate_on_chan_open_ack_fail_if_counterpary_version_is_invalid() fail {
  transfer_ibc_module.validate_on_chan_open_ack(
    "port-1",
    "channel-0",
    "channel-10",
    "invalid version",
  )
}

//===========================================validate_on_recv_packet=====================================

test validate_on_chan_recv_packet_succeed() {
  let ack = acknowledgement_mod.new_result_acknowledgement(#"01")

  transfer_ibc_module.validate_on_chan_recv_packet(ack)
}

test validate_on_chan_recv_packet_fail_if_ack_is_invalid() fail {
  let ack = acknowledgement_mod.new_result_acknowledgement("invalid ack")

  transfer_ibc_module.validate_on_chan_recv_packet(ack)
}
