use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{Closed, Open}

fn setup() -> (ChannelDatum, ChannelDatum) {
  let mock_auth_token =
    AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let input_channel =
    channel_mod.new(
      Open,
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
        channel: Channel { ..input_channel_datum.state.channel, state: Closed },
      },
    }

  (input_channel_datum, output_channel_datum)
}

test succeed() {
  let (input_datum, output_datum) = setup()
  channel_datum_mod.validate_chan_close_init(input_datum, output_datum)
}

test fail_if_output_channel_state_is_not_closed() {
  let (input_datum, output_datum) = setup()

  let output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        channel: Channel { ..output_datum.state.channel, state: Open },
      },
    }

  channel_datum_mod.validate_chan_close_init(input_datum, output_datum) == False
}
