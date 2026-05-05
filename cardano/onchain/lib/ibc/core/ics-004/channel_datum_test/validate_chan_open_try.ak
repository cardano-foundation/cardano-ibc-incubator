use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{Init, TryOpen}

fn setup() -> (ChannelDatum, AuthToken) {
  let mock_auth_token =
    AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let channel =
    channel_mod.new(
      TryOpen,
      Unordered,
      counterparty: ChannelCounterparty {
        port_id: "bank",
        channel_id: "channel-10",
      },
      connection_hops: ["connection-1"],
      version: "ics20-1",
    )

  let mock_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: "port-1",
      token: mock_auth_token,
    }

  (mock_channel_datum, mock_auth_token)
}

test succeed() {
  let (chan_datum, auth_token) = setup()
  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_channel_validate_basic_invalid() fail {
  let invalid_channel = channel_mod.null_channel()

  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState { ..chan_datum.state, channel: invalid_channel },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_auth_token_not_matched() fail {
  let invalid_auth_token =
    AuthToken { policy_id: "invalid policy_id", name: "invalid name" }
  let (chan_datum, auth_token) = setup()

  let chan_datum = ChannelDatum { ..chan_datum, token: invalid_auth_token }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_channel_state_is_not_tryopen() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState {
        ..chan_datum.state,
        channel: Channel { ..chan_datum.state.channel, state: Init },
      },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_channel_counterparty_channel_id_is_null() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState {
        ..chan_datum.state,
        channel: Channel {
          ..chan_datum.state.channel,
          counterparty: ChannelCounterparty {
            ..chan_datum.state.channel.counterparty,
            channel_id: "",
          },
        },
      },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_next_sequence_send_is_not_1() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState { ..chan_datum.state, next_sequence_send: 2 },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_next_sequence_recv_is_not_1() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState { ..chan_datum.state, next_sequence_recv: 0 },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_next_sequence_ack_is_not_1() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState { ..chan_datum.state, next_sequence_ack: 0 },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_packet_commitment_is_not_empty() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState {
        ..chan_datum.state,
        packet_commitment: [Pair(1, "")],
      },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_packet_receipt_is_not_empty() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState {
        ..chan_datum.state,
        packet_receipt: [Pair(1, "")],
      },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_packet_acknowledgement_is_not_empty() fail {
  let (chan_datum, auth_token) = setup()

  let chan_datum =
    ChannelDatum {
      ..chan_datum,
      state: ChannelDatumState {
        ..chan_datum.state,
        packet_acknowledgement: [Pair(1, "")],
      },
    }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}

test fail_if_port_id_is_invalid() fail {
  let (chan_datum, auth_token) = setup()

  // Slash is not allowed in IBC identifiers (it would break commitment paths).
  let chan_datum = ChannelDatum { ..chan_datum, port_id: "ports/transfer" }

  channel_datum_mod.validate_chan_open_try(chan_datum, auth_token)
}
