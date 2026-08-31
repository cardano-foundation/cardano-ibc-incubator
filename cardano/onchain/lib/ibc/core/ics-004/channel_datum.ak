use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/int
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_024_host_requirements/validate as host_validate_mod

pub type ChannelDatum {
  state: ChannelDatumState,
  port_id: ByteArray,
  token: AuthToken,
}

pub type ChannelDatumState {
  channel: Channel,
  next_sequence_send: Int,
  next_sequence_recv: Int,
  next_sequence_ack: Int,
  packet_commitment: Pairs<Int, ByteArray>,
  packet_receipt: Pairs<Int, ByteArray>,
  packet_acknowledgement: Pairs<Int, ByteArray>,
  /// Old packet-membership proofs below this counterparty height are rejected.
  ///
  /// This permits finalized packet history to be pruned without making a
  /// historical commitment proof replayable.
  minimum_receive_proof_height: Height,
  /// Greatest counterparty proof height used by any successful receive.
  ///
  /// Unlike the minimum, this does not reject out-of-order receives. A prune
  /// must reach this high-water mark so its absence proof cannot predate a
  /// packet whose retained history it deletes.
  maximum_receive_proof_height: Height,
}

/// Ledger-safe upper bound for all packet entries retained in a channel datum.
/// Packet insertion fails closed at this boundary so the combined commitment,
/// receipt, and acknowledgement state cannot make the datum unspendable.
pub const max_packet_entries_per_channel = 64

pub fn packet_entry_count(state: ChannelDatumState) -> Int {
  list.length(state.packet_commitment) + list.length(state.packet_receipt) + list.length(
    state.packet_acknowledgement,
  )
}

/// Delete the first entry for `key` and report whether one was removed.
///
/// `pairs.delete_first` and `pairs.has_key` each scan the list. Packet pruning
/// needs both results, so deriving them together avoids a second full scan at
/// the channel history limit.
fn delete_first_with_presence(
  self: Pairs<key, value>,
  key: key,
) -> (Bool, Pairs<key, value>) {
  when self is {
    [] -> (False, [])
    [Pair(entry_key, _) as head, ..tail] ->
      if key == entry_key {
        (True, tail)
      } else {
        let (found, remaining) = delete_first_with_presence(tail, key)
        (found, [head, ..remaining])
      }
  }
}

pub fn validate_chan_open_init(
  datum: ChannelDatum,
  auth_token: AuthToken,
) -> Bool {
  let ChannelDatum { state, port_id, token } = datum

  let ChannelDatumState {
    channel,
    next_sequence_send,
    next_sequence_recv,
    next_sequence_ack,
    minimum_receive_proof_height,
    maximum_receive_proof_height,
    packet_commitment,
    packet_receipt,
    packet_acknowledgement,
  } = state

  let Channel { state: chan_state, counterparty, .. } = channel
  and {
    channel.validate_basic(channel),
    token == auth_token,
    chan_state == channel_state.Init,
    counterparty.channel_id == "",
    and {
      next_sequence_send == 1,
      next_sequence_recv == 1,
      next_sequence_ack == 1,
      minimum_receive_proof_height == height_mod.zero_height(),
      maximum_receive_proof_height == height_mod.zero_height(),
    },
    and {
      list.is_empty(packet_commitment),
      list.is_empty(packet_receipt),
      list.is_empty(packet_acknowledgement),
    },
    port_keys_mod.is_valid_port_id(port_id),
  }
}

pub fn validate_chan_open_try(
  datum: ChannelDatum,
  auth_token: AuthToken,
) -> Bool {
  let ChannelDatum { state, port_id, token } = datum

  let ChannelDatumState {
    channel,
    next_sequence_send,
    next_sequence_recv,
    next_sequence_ack,
    minimum_receive_proof_height,
    maximum_receive_proof_height,
    packet_commitment,
    packet_receipt,
    packet_acknowledgement,
  } = state

  let Channel { state: chan_state, counterparty, .. } = channel

  and {
    channel.validate_basic(channel),
    token == auth_token,
    chan_state == channel_state.TryOpen,
    counterparty.channel_id != "",
    and {
      next_sequence_send == 1,
      next_sequence_recv == 1,
      next_sequence_ack == 1,
      minimum_receive_proof_height == height_mod.zero_height(),
      maximum_receive_proof_height == height_mod.zero_height(),
    },
    and {
      list.is_empty(packet_commitment),
      list.is_empty(packet_receipt),
      list.is_empty(packet_acknowledgement),
    },
    port_keys_mod.is_valid_port_id(port_id),
  }
}

pub fn validate_chan_open_ack(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let ChannelDatumState { channel: input_chan, .. } = input_datum.state

  // input's Channel is Init state
  expect input_chan.state == channel_state.Init

  let ChannelDatumState { channel: output_chan, .. } = output_datum.state

  // output's Channel is updated correctly
  let output_counterpary_chan_id = output_chan.counterparty.channel_id

  expect
    host_validate_mod.channel_identifier_validator(output_counterpary_chan_id)

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_chan,
          state: channel_state.Open,
          counterparty: ChannelCounterparty {
            ..input_chan.counterparty,
            channel_id: output_counterpary_chan_id,
          },
        },
      },
    }

  expected_datum == output_datum
}

pub fn validate_chan_open_confirm(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  // input's Channel is Init state
  expect input_datum.state.channel.state == channel_state.TryOpen

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: channel_state.Open,
        },
      },
    }

  expected_datum == output_datum
}

pub fn validate_chan_close_init(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: channel_state.Closed,
        },
      },
    }

  expected_datum == output_datum
}

pub fn validate_chan_close_confirm(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
) -> Bool {
  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: channel_state.Closed,
        },
      },
    }

  expected_datum == output_datum
}

pub fn validate_recv_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  ack: ByteArray,
  proof_height: Height,
) -> Bool {
  let valid_sequence =
    when input_datum.state.channel.ordering is {
      order.Ordered -> packet.sequence == input_datum.state.next_sequence_recv
      order.Unordered -> True
      _ -> False
    }

  let (expected_packet_receipt, expected_next_sequence_recv, inserted_entries) =
    when input_datum.state.channel.ordering is {
      order.Ordered ->
        (
          input_datum.state.packet_receipt,
          input_datum.state.next_sequence_recv + 1,
          1,
        )
      order.Unordered ->
        (
          [Pair(packet.sequence, ""), ..input_datum.state.packet_receipt],
          input_datum.state.next_sequence_recv,
          2,
        )
      _ -> fail
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        next_sequence_recv: expected_next_sequence_recv,
        maximum_receive_proof_height: if height_mod.compare(
          proof_height,
          input_datum.state.maximum_receive_proof_height,
        ) == Greater {
          proof_height
        } else {
          input_datum.state.maximum_receive_proof_height
        },
        packet_receipt: expected_packet_receipt,
        packet_acknowledgement: pairs.insert_by_ascending_key(
          input_datum.state.packet_acknowledgement,
          packet.sequence,
          ack,
          int.compare,
        ),
      },
    }

  and {
    valid_sequence,
    height_mod.compare(
      proof_height,
      input_datum.state.minimum_receive_proof_height,
    ) != Less,
    packet_entry_count(input_datum.state) + inserted_entries <= max_packet_entries_per_channel,
    expected_datum == output_datum,
  }
}

/// Delete finalized inbound packet history without weakening replay protection.
///
/// The operation validator separately proves that the corresponding source
/// commitment is absent at `proof_height`. Unordered channels delete the
/// receipt and acknowledgement together; ordered channels retain their
/// monotonic receive sequence and delete only the acknowledgement. Advancing
/// the floor atomically prevents any older membership proof from being used
/// after history is removed.
pub fn validate_prune_packet_history(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  sequence: Int,
  proof_height: Height,
) -> Bool {
  let (has_acknowledgement, expected_packet_acknowledgement) =
    delete_first_with_presence(
      input_datum.state.packet_acknowledgement,
      sequence,
    )
  let (expected_packet_receipt, valid_ordering_state) =
    when input_datum.state.channel.ordering is {
      order.Unordered ->
        (
          pairs.delete_first(input_datum.state.packet_receipt, sequence),
          pairs.has_key(input_datum.state.packet_receipt, sequence),
        )
      order.Ordered ->
        (
          input_datum.state.packet_receipt,
          sequence < input_datum.state.next_sequence_recv,
        )
      _ -> fail
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        minimum_receive_proof_height: proof_height,
        packet_receipt: expected_packet_receipt,
        packet_acknowledgement: expected_packet_acknowledgement,
      },
    }

  and {
    valid_ordering_state,
    has_acknowledgement,
    height_mod.compare(
      proof_height,
      input_datum.state.minimum_receive_proof_height,
    ) != Less,
    height_mod.compare(
      proof_height,
      input_datum.state.maximum_receive_proof_height,
    ) != Less,
    expected_datum == output_datum,
  }
}

pub fn validate_send_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  commitment: ByteArray,
) -> Bool {
  // WORKAROUND: cloned output_datum required to "replace" an "apparently" unbounded list to a bounded one, or it would fail
  // to pass the equality check. This will make the validator to correctly pass
  let cloned_output_datum =
    ChannelDatum {
      ..output_datum,
      state: ChannelDatumState {
        ..output_datum.state,
        packet_commitment: pairs.map(
          output_datum.state.packet_commitment,
          fn(_k, v) { v },
        ),
      },
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        next_sequence_send: input_datum.state.next_sequence_send + 1,
        packet_commitment: pairs.insert_by_ascending_key(
          input_datum.state.packet_commitment,
          packet.sequence,
          commitment,
          int.compare,
        ),
      },
    }

  and {
    packet_entry_count(input_datum.state) < max_packet_entries_per_channel,
    expected_datum == cloned_output_datum,
  }
}

pub fn validate_timeout_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
) -> Bool {
  let expected_channel_state =
    if input_datum.state.channel.ordering == order.Ordered {
      channel_state.Closed
    } else {
      channel_state.Open
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel {
          ..input_datum.state.channel,
          state: expected_channel_state,
        },
        packet_commitment: pairs.delete_first(
          input_datum.state.packet_commitment,
          packet.sequence,
        ),
      },
    }

  expected_datum == output_datum
}

pub fn validate_acknowledge_packet(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
) -> Bool {
  let expected_next_seq_ack =
    if input_datum.state.channel.ordering == order.Ordered {
      input_datum.state.next_sequence_ack + 1
    } else {
      input_datum.state.next_sequence_ack
    }

  let expected_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        packet_commitment: pairs.delete_first(
          input_datum.state.packet_commitment,
          packet.sequence,
        ),
        next_sequence_ack: expected_next_seq_ack,
      },
    }

  expected_datum == output_datum
}
