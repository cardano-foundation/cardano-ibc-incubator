use aiken/fuzz
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{Closed, Init, Open, TryOpen}
use ibc/testing/fuzz_dsl

fn mock_token() -> AuthToken {
  AuthToken { policy_id: "mock policy_id", name: "mock name" }
}

fn channel_datum(state, counterparty_channel_id: ByteArray) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: channel_mod.new(
        state,
        Unordered,
        counterparty: ChannelCounterparty {
          port_id: "bank",
          channel_id: counterparty_channel_id,
        },
        connection_hops: ["connection-1"],
        version: "ics20-1",
      ),
      next_sequence_send: 1,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment: [],
      packet_receipt: [],
      packet_acknowledgement: [],
    },
    port_id: "port-1",
    token: mock_token(),
  }
}

fn open_ack_datums() -> (ChannelDatum, ChannelDatum) {
  let input_datum = channel_datum(Init, "")
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: Open,
          counterparty: ChannelCounterparty {
            ..input_datum.state.channel.counterparty,
            channel_id: "channel-34",
          },
        },
      },
    }

  (input_datum, output_datum)
}

fn open_confirm_datums() -> (ChannelDatum, ChannelDatum) {
  let input_datum = channel_datum(TryOpen, "")
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel { ..input_datum.state.channel, state: Open },
      },
    }

  (input_datum, output_datum)
}

fn close_datums() -> (ChannelDatum, ChannelDatum) {
  let input_datum = channel_datum(Open, "")
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel { ..input_datum.state.channel, state: Closed },
      },
    }

  (input_datum, output_datum)
}

fn channel_allows_send(channel_datum: ChannelDatum) -> Bool {
  channel_datum.state.channel.state == Open
}

test prop_chan_open_ack_accepts_valid_transition(_seed via fuzz.int()) {
  fuzz.label(@"contract.chan.open_ack.valid")

  let (input_datum, output_datum) = open_ack_datums()
  fuzz_dsl.valid_check(
    "chan",
    "open_ack",
    "channel_datum.validate_chan_open_ack",
    channel_datum_mod.validate_chan_open_ack(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_open_confirm_accepts_valid_transition(_seed via fuzz.int()) {
  fuzz.label(@"contract.chan.open_confirm.valid")

  let (input_datum, output_datum) = open_confirm_datums()
  fuzz_dsl.valid_check(
    "chan",
    "open_confirm",
    "channel_datum.validate_chan_open_confirm",
    channel_datum_mod.validate_chan_open_confirm(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_close_init_accepts_core_close_transition(_seed via fuzz.int()) {
  fuzz.label(@"contract.chan.close_init.valid_or_rejected_by_app_policy")

  let (input_datum, output_datum) = close_datums()
  fuzz_dsl.valid_check(
    "chan",
    "close_init",
    "channel_datum.validate_chan_close_init",
    channel_datum_mod.validate_chan_close_init(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_close_confirm_accepts_valid_transition(_seed via fuzz.int()) {
  fuzz.label(@"contract.chan.close_confirm.valid")

  let (input_datum, output_datum) = close_datums()
  fuzz_dsl.valid_check(
    "chan",
    "close_confirm",
    "channel_datum.validate_chan_close_confirm",
    channel_datum_mod.validate_chan_close_confirm(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_closed_rejects_send(_seed via fuzz.int()) {
  fuzz.label(@"contract.chan.closed.rejects_send")

  fuzz_dsl.mutated_check(
    "chan",
    "send",
    "closed_channel",
    "channel_allows_send",
    channel_allows_send(channel_datum(Closed, "channel-34")),
  )
    |> fuzz_dsl.assert_rejected
}
