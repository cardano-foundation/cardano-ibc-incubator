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

type ChannelLifecycleModel {
  ChannelLifecycleModel { channel: ChannelDatum }
}

fn channel_model_from(channel: ChannelDatum) -> ChannelLifecycleModel {
  ChannelLifecycleModel { channel }
}

fn model_open_ack(
  model: ChannelLifecycleModel,
  counterparty_channel_id: ByteArray,
) -> ChannelLifecycleModel {
  ChannelLifecycleModel {
    channel: ChannelDatum {
      ..model.channel,
      state: ChannelDatumState {
        ..model.channel.state,
        channel: Channel {
          ..model.channel.state.channel,
          state: Open,
          counterparty: ChannelCounterparty {
            ..model.channel.state.channel.counterparty,
            channel_id: counterparty_channel_id,
          },
        },
      },
    },
  }
}

fn model_close(model: ChannelLifecycleModel) -> ChannelLifecycleModel {
  ChannelLifecycleModel {
    channel: ChannelDatum {
      ..model.channel,
      state: ChannelDatumState {
        ..model.channel.state,
        channel: Channel { ..model.channel.state.channel, state: Closed },
      },
    },
  }
}

test prop_chan_open_ack_accepts_valid_transition(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.chan.open_ack.valid")

  let (input_datum, output_datum) = open_ack_datums()
  fuzz_dsl.valid_check(
    "chan",
    "open_ack",
    "channel_datum.validate_chan_open_ack",
    channel_datum_mod.validate_chan_open_ack(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_model_channel_open_close_reject_send(_seed via fuzz.int()) {
  fuzz.label(@"regression.model.channel.open_close_reject_send")

  let initial_model = channel_datum(Init, "") |> channel_model_from
  let opened_model = model_open_ack(initial_model, "channel-34")
  let closed_model = model_close(opened_model)

  and {
    fuzz_dsl.valid_check(
      "chan",
      "model_open_ack",
      "channel_datum.validate_chan_open_ack",
      channel_datum_mod.validate_chan_open_ack(
        initial_model.channel,
        opened_model.channel,
      ),
    )
      |> fuzz_dsl.assert_valid,
    fuzz_dsl.valid_check(
      "chan",
      "model_close",
      "channel_datum.validate_chan_close_init",
      channel_datum_mod.validate_chan_close_init(
        opened_model.channel,
        closed_model.channel,
      ),
    )
      |> fuzz_dsl.assert_valid,
    fuzz_dsl.mutated_check(
      "chan",
      "model_send",
      "closed_channel",
      "channel_allows_send",
      channel_allows_send(closed_model.channel),
    )
      |> fuzz_dsl.assert_rejected,
  }
}

test prop_chan_open_confirm_accepts_valid_transition(_seed via fuzz.int()) {
  fuzz.label(@"regression.contract.chan.open_confirm.valid")

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
  fuzz.label(
    @"regression.contract.chan.close_init.valid_or_rejected_by_app_policy",
  )

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
  fuzz.label(@"regression.contract.chan.close_confirm.valid")

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
  fuzz.label(@"regression.contract.chan.closed.rejects_send")

  fuzz_dsl.mutated_check(
    "chan",
    "send",
    "closed_channel",
    "channel_allows_send",
    channel_allows_send(channel_datum(Closed, "channel-34")),
  )
    |> fuzz_dsl.assert_rejected
}
