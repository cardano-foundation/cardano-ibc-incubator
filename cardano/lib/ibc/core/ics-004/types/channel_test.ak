use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{None, Unordered}
use ibc/core/ics_004/types/state.{Init, Uninitialized}

fn setup() -> Channel {
  channel_mod.new(
    Init,
    Unordered,
    counterparty: ChannelCounterparty { port_id: "bank", channel_id: "" },
    connection_hops: ["connection-1"],
    version: "ics20-1",
  )
}

test succeed() {
  let channel = setup()

  channel_mod.validate_basic(channel)
}

test fail_if_state_is_uninitialized() fail {
  let channel = setup()

  let channel = Channel { ..channel, state: Uninitialized }

  channel_mod.validate_basic(channel)
}

test fail_if_ordering_is_invalid() fail {
  let channel = setup()

  let channel = Channel { ..channel, ordering: None }

  channel_mod.validate_basic(channel)
}

test fail_if_connection_hops_number_is_not_1() fail {
  let channel = setup()

  let invalid_connection_hops =
    ["connection-99", ..channel.connection_hops]

  let channel = Channel { ..channel, connection_hops: invalid_connection_hops }

  channel_mod.validate_basic(channel)
}

test fail_if_connection_id_is_invalid() fail {
  let channel = setup()

  let invalid_connection_hops =
    ["invalid id ##^^%%"]

  let channel = Channel { ..channel, connection_hops: invalid_connection_hops }

  channel_mod.validate_basic(channel)
}

test fail_if_counterparty_is_invalid() fail {
  let channel = setup()

  let invalid_counterparty =
    ChannelCounterparty { ..channel.counterparty, port_id: "invalid id%&$" }

  let channel = Channel { ..channel, counterparty: invalid_counterparty }

  channel_mod.validate_basic(channel)
}
