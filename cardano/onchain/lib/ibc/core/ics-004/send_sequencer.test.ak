use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/send_sequencer.{SendSequencerDatum}
use ibc/core/ics_004/types/packet.{Packet}

fn sequencer() -> SendSequencerDatum {
  SendSequencerDatum {
    port_id: "transfer",
    channel_id: "channel-0",
    version: 0,
    next_sequence_send: 1,
  }
}

fn packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "transfer",
    source_channel: "channel-0",
    destination_port: "transfer",
    destination_channel: "channel-1",
    data: "transfer",
    timeout_height: Height { revision_number: 0, revision_height: 0 },
    timeout_timestamp: 1_000_000_000,
  }
}

test send_sequencer_five_packets_then_next_batch_without_acknowledgements() {
  let first =
    send_sequencer.advance(sequencer(), list.map([1, 2, 3, 4, 5], packet))
  let second = send_sequencer.advance(first, list.map([6, 7], packet))
  and {
    first.next_sequence_send == 6,
    second.next_sequence_send == 8,
    second.version == 2,
  }
}

test send_sequencer_cannot_skip_a_sequence() fail {
  expect _ = send_sequencer.advance(sequencer(), list.map([1, 3], packet))
}

test send_sequencer_cannot_repeat_a_sequence() fail {
  expect _ = send_sequencer.advance(sequencer(), list.map([1, 1], packet))
}

test send_sequencer_rejects_empty_batch() fail {
  expect _ = send_sequencer.advance(sequencer(), [])
}

test send_sequencer_rejects_overflow() fail {
  expect _ =
    send_sequencer.advance(
      SendSequencerDatum {
        ..sequencer(),
        next_sequence_send: 18_446_744_073_709_551_615,
      },
      [packet(18_446_744_073_709_551_615)],
    )
}
