use ibc/core/ics_004/types/counterparty.{ChannelCounterparty} as counterparty_mod

fn setup() -> ChannelCounterparty {
  ChannelCounterparty { port_id: "port-1", channel_id: "channel-66" }
}

test succeed() {
  let counterparty = setup()

  counterparty_mod.validate_basic(counterparty)
}

test fail_if_port_id_invalid() fail {
  let counterparty = setup()

  let counterparty =
    ChannelCounterparty { ..counterparty, port_id: "invalid id%&$" }

  counterparty_mod.validate_basic(counterparty)
}

test fail_if_channel_id_invalid() fail {
  let counterparty = setup()

  let counterparty =
    ChannelCounterparty { ..counterparty, channel_id: "invalid id%&$" }

  counterparty_mod.validate_basic(counterparty)
}
