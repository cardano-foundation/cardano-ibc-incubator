use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{Init, Open, TryOpen}

fn setup() -> (ChannelDatum, ChannelDatum) {
  let mock_auth_token =
    AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let input_channel =
    channel_mod.new(
      Init,
      Unordered,
      counterparty: ChannelCounterparty { port_id: "bank", channel_id: "" },
      connection_hops: ["connection-1"],
      version: "ics20-1",
    )

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
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

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        channel: Channel {
          ..input_channel_datum.state.channel,
          state: Open,
          counterparty: ChannelCounterparty {
            ..input_channel_datum.state.channel.counterparty,
            channel_id: "channel-34",
          },
        },
      },
    }

  (input_channel_datum, output_channel_datum)
}

test succeed() {
  let (input_datum, output_datum) = setup()
  channel_datum_mod.is_channel_open_ack_valid(input_datum, output_datum)
}

test fail_if_input_channel_state_is_not_init() fail {
  let (input_datum, output_datum) = setup()

  let input_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel { ..input_datum.state.channel, state: TryOpen },
      },
    }

  channel_datum_mod.is_channel_open_ack_valid(input_datum, output_datum)
}

test fail_if_output_channel_counterparty_channel_id_is_null() fail {
  let (input_datum, output_datum) = setup()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        channel: Channel {
          ..output_datum.state.channel,
          counterparty: ChannelCounterparty {
            ..output_datum.state.channel.counterparty,
            channel_id: "",
          },
        },
      },
    }

  channel_datum_mod.is_channel_open_ack_valid(input_datum, output_datum)
}

test fail_if_output_channel_validate_basic_invalid() fail {
  let (input_datum, output_datum) = setup()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        channel: Channel {
          ..output_datum.state.channel,
          counterparty: ChannelCounterparty {
            ..output_datum.state.channel.counterparty,
            channel_id: "short",
          },
        },
      },
    }

  channel_datum_mod.is_channel_open_ack_valid(input_datum, output_datum)
}

test fail_if_output_channel_state_is_not_open() fail {
  let (input_datum, output_datum) = setup()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        channel: Channel { ..output_datum.state.channel, state: Init },
      },
    }

  channel_datum_mod.is_channel_open_ack_valid(input_datum, output_datum)
}
