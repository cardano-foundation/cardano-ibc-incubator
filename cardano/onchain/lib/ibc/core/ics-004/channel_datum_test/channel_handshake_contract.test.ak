use aiken/fuzz
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/state.{Closed, Init, Open, TryOpen}
use ibc/testing/fuzz_dsl
use ibc/utils/int as int_utils

type HandshakeCase {
  HandshakeCase {
    ordering: Order,
    remote_channel_id: ByteArray,
    version: ByteArray,
    next_send: Int,
    next_recv: Int,
    next_ack: Int,
  }
}

fn handshake_case() -> Fuzzer<HandshakeCase> {
  fuzz.map4(
    fuzz.bool(),
    fuzz.int_between(0, 65535),
    fuzz.bytearray_between(1, 32),
    fuzz.tuple3(
      fuzz.int_between(1, 1000000),
      fuzz.int_between(1, 1000000),
      fuzz.int_between(1, 1000000),
    ),
    fn(ordered, sequence, version, packet_sequences) {
      let (next_send, next_recv, next_ack) = packet_sequences
      HandshakeCase {
        ordering: if ordered {
          Ordered
        } else {
          Unordered
        },
        remote_channel_id: channel_keys.format_channel_identifier(
          int_utils.to_string(sequence),
        ),
        version,
        next_send,
        next_recv,
        next_ack,
      }
    },
  )
}

fn mock_token() -> AuthToken {
  AuthToken { policy_id: "mock policy_id", name: "mock name" }
}

fn channel_datum(
  state,
  counterparty_channel_id: ByteArray,
  sample: HandshakeCase,
) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      maximum_receive_proof_height: height_mod.zero_height(),
      minimum_receive_proof_height: height_mod.zero_height(),
      channel: channel_mod.new(
        state,
        sample.ordering,
        counterparty: ChannelCounterparty {
          port_id: "bank",
          channel_id: counterparty_channel_id,
        },
        connection_hops: ["connection-1"],
        version: sample.version,
      ),
      next_sequence_send: sample.next_send,
      next_sequence_recv: sample.next_recv,
      next_sequence_ack: sample.next_ack,
      packet_commitment: [],
      packet_receipt: [],
      packet_acknowledgement: [],
    },
    port_id: "port-1",
    token: mock_token(),
  }
}

fn open_ack_datums(sample: HandshakeCase) -> (ChannelDatum, ChannelDatum) {
  let input_datum = channel_datum(Init, "", sample)
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
            channel_id: sample.remote_channel_id,
          },
        },
      },
    }

  (input_datum, output_datum)
}

fn open_confirm_datums(sample: HandshakeCase) -> (ChannelDatum, ChannelDatum) {
  let input_datum = channel_datum(TryOpen, sample.remote_channel_id, sample)
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

fn close_datums(sample: HandshakeCase) -> (ChannelDatum, ChannelDatum) {
  let input_datum = channel_datum(Open, sample.remote_channel_id, sample)
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

test prop_chan_open_ack_accepts_valid_transition(sample via handshake_case()) {
  fuzz.label(@"fuzz.unit.chan.open_ack.valid")

  let (input_datum, output_datum) = open_ack_datums(sample)
  fuzz_dsl.valid_check(
    "chan",
    "open_ack",
    "channel_datum.validate_chan_open_ack",
    channel_datum_mod.validate_chan_open_ack(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_model_channel_open_close_preserves_state(sample via handshake_case()) {
  fuzz.label(@"fuzz.model.channel.open_close_preserves_state")

  let initial_model = channel_datum(Init, "", sample) |> channel_model_from
  let opened_model = model_open_ack(initial_model, sample.remote_channel_id)
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
    closed_model.channel.state.channel.state == Closed,
    closed_model.channel.state.next_sequence_send == sample.next_send,
    closed_model.channel.state.next_sequence_recv == sample.next_recv,
    closed_model.channel.state.next_sequence_ack == sample.next_ack,
  }
}

test prop_chan_open_confirm_accepts_valid_transition(
  sample via handshake_case(),
) {
  fuzz.label(@"fuzz.unit.chan.open_confirm.valid")

  let (input_datum, output_datum) = open_confirm_datums(sample)
  fuzz_dsl.valid_check(
    "chan",
    "open_confirm",
    "channel_datum.validate_chan_open_confirm",
    channel_datum_mod.validate_chan_open_confirm(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_close_init_accepts_core_close_transition(
  sample via handshake_case(),
) {
  fuzz.label(@"fuzz.unit.chan.close_init.valid")

  let (input_datum, output_datum) = close_datums(sample)
  fuzz_dsl.valid_check(
    "chan",
    "close_init",
    "channel_datum.validate_chan_close_init",
    channel_datum_mod.validate_chan_close_init(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_close_confirm_accepts_valid_transition(
  sample via handshake_case(),
) {
  fuzz.label(@"fuzz.unit.chan.close_confirm.valid")

  let (input_datum, output_datum) = close_datums(sample)
  fuzz_dsl.valid_check(
    "chan",
    "close_confirm",
    "channel_datum.validate_chan_close_confirm",
    channel_datum_mod.validate_chan_close_confirm(input_datum, output_datum),
  )
    |> fuzz_dsl.assert_valid
}

test prop_chan_close_rejects_packet_sequence_change(sample via handshake_case()) {
  fuzz.label(@"fuzz.unit.chan.close.invalid_packet_sequence")
  let (input_datum, output_datum) = close_datums(sample)
  let mutated_output =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        next_sequence_send: output_datum.state.next_sequence_send + 1,
      },
    }
  fuzz_dsl.mutated_check(
    "chan",
    "close_init",
    "changed_packet_sequence",
    "channel_datum.validate_chan_close_init",
    channel_datum_mod.validate_chan_close_init(input_datum, mutated_output),
  )
    |> fuzz_dsl.assert_rejected
}
