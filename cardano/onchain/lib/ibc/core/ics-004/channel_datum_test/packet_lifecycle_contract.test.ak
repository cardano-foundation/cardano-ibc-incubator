use aiken/collection/pairs
use aiken/fuzz
use cardano/address.{from_script}
use cardano/assets as assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Spend}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{SendPacket, SpendChannelRedeemer}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/acknowledgement.{Acknowledgement}
use ibc/core/ics_004/types/channel.{Channel} as channel_mod
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Order, Ordered, Unordered}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state.{Closed, Open}
use ibc/testing/fuzz_dsl

type SendPacketFixture {
  SendPacketFixture {
    model: fuzz_dsl.ModelState,
    mutation: fuzz_dsl.Mutation,
    input_datum: ChannelDatum,
    output_datum: ChannelDatum,
    packet: Packet,
    commitment: ByteArray,
    channel_redeemer: SpendChannelRedeemer,
  }
}

fn test_output_ref(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: index,
  }
}

fn channel_output(datum: ChannelDatum) -> Output {
  Output {
    address: from_script("channel script hash"),
    value: assets.zero,
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn channel_input(datum: ChannelDatum) -> Input {
  Input { output_reference: test_output_ref(0), output: channel_output(datum) }
}

fn mock_token() -> AuthToken {
  AuthToken { policy_id: "mock policy_id", name: "mock name" }
}

fn base_packet(sequence: Int) -> Packet {
  Packet {
    sequence,
    source_port: "port-1",
    source_channel: "channel-0",
    destination_port: "bank",
    destination_channel: "channel-90",
    data: "mock packet data",
    timeout_height: height_mod.zero_height(),
    timeout_timestamp: 100,
  }
}

fn base_datum(ordering: Order, next_sequence_send: Int) -> ChannelDatum {
  ChannelDatum {
    state: ChannelDatumState {
      channel: channel_mod.new(
        Open,
        ordering,
        counterparty: ChannelCounterparty {
          port_id: "bank",
          channel_id: "channel-90",
        },
        connection_hops: ["connection-1"],
        version: "ics20-1",
      ),
      next_sequence_send,
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

fn send_output(
  input_datum: ChannelDatum,
  packet: Packet,
  commitment: ByteArray,
) -> ChannelDatum {
  ChannelDatum {
    ..input_datum,
    state: ChannelDatumState {
      ..input_datum.state,
      next_sequence_send: input_datum.state.next_sequence_send + 1,
      packet_commitment: [
        Pair(packet.sequence, commitment),
        ..input_datum.state.packet_commitment
      ],
    },
  }
}

fn send_contract(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  commitment: ByteArray,
  channel_redeemer: SpendChannelRedeemer,
) -> Bool {
  and {
    input_datum.state.channel.state == Open,
    packet.sequence == input_datum.state.next_sequence_send,
    packet.source_port == input_datum.port_id,
    packet.source_channel == "channel-0",
    packet.destination_port == input_datum.state.channel.counterparty.port_id,
    packet.destination_channel == input_datum.state.channel.counterparty.channel_id,
    channel_redeemer == SendPacket { packet },
    channel_datum_mod.validate_send_packet(
      input_datum,
      output_datum,
      packet,
      commitment,
    ),
  }
}

fn build_send_packet_fixture(packet: Packet) -> SendPacketFixture {
  let input_datum = base_datum(Unordered, packet.sequence)
  let commitment = packet_mod.commit_packet(packet)
  let output_datum = send_output(input_datum, packet, commitment)

  SendPacketFixture {
    model: fuzz_dsl.model("packet", "send"),
    mutation: fuzz_dsl.no_mutation(),
    input_datum,
    output_datum,
    packet,
    commitment,
    channel_redeemer: SendPacket { packet },
  }
}

fn mutate_wrong_sequence(fixture: SendPacketFixture) -> SendPacketFixture {
  let packet =
    Packet { ..fixture.packet, sequence: fixture.packet.sequence + 1 }
  let commitment = packet_mod.commit_packet(packet)

  SendPacketFixture {
    ..fixture,
    mutation: fuzz_dsl.mutation("wrong_sequence"),
    output_datum: send_output(fixture.input_datum, packet, commitment),
    packet,
    commitment,
    channel_redeemer: SendPacket { packet },
  }
}

fn mutate_missing_commitment_root_update(
  fixture: SendPacketFixture,
) -> SendPacketFixture {
  SendPacketFixture {
    ..fixture,
    mutation: fuzz_dsl.mutation("missing_commitment_root_update"),
    output_datum: ChannelDatum {
      ..fixture.output_datum,
      state: ChannelDatumState {
        ..fixture.output_datum.state,
        packet_commitment: fixture.input_datum.state.packet_commitment,
      },
    },
  }
}

fn mutate_wrong_transfer_callback(
  fixture: SendPacketFixture,
) -> SendPacketFixture {
  let wrong_packet =
    Packet { ..fixture.packet, data: "wrong transfer packet data" }

  SendPacketFixture {
    ..fixture,
    mutation: fuzz_dsl.mutation("wrong_transfer_callback"),
    channel_redeemer: SendPacket { packet: wrong_packet },
  }
}

fn run_send_packet_transition(
  fixture: SendPacketFixture,
) -> fuzz_dsl.ProtocolTxFixture {
  let input = channel_input(fixture.input_datum)

  fuzz_dsl.protocol_tx_fixture(
    fixture.model,
    fuzz_dsl.model("packet", "send.after"),
    fixture.mutation,
  )
    |> fuzz_dsl.with_input(input)
    |> fuzz_dsl.with_output(channel_output(fixture.output_datum))
    |> fuzz_dsl.with_redeemer(
        Spend(input.output_reference),
        fixture.channel_redeemer,
      )
    |> fuzz_dsl.with_protocol_validator_check(
        "channel.validate_send_packet",
        send_contract(
          fixture.input_datum,
          fixture.output_datum,
          fixture.packet,
          fixture.commitment,
          fixture.channel_redeemer,
        ),
      )
}

fn run_recv_packet_transition(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  ack: ByteArray,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  fuzz_dsl.protocol_tx_fixture(
    fuzz_dsl.model("packet", "recv"),
    fuzz_dsl.model("packet", "recv.after"),
    mutation,
  )
    |> fuzz_dsl.with_input(channel_input(input_datum))
    |> fuzz_dsl.with_output(channel_output(output_datum))
    |> fuzz_dsl.with_protocol_validator_check(
        "channel.validate_recv_packet",
        recv_contract(input_datum, output_datum, packet, ack),
      )
}

fn run_ack_packet_transition(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  acknowledgement: Acknowledgement,
  acknowledgement_bytes: ByteArray,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  fuzz_dsl.protocol_tx_fixture(
    fuzz_dsl.model("packet", "ack"),
    fuzz_dsl.model("packet", "ack.after"),
    mutation,
  )
    |> fuzz_dsl.with_input(channel_input(input_datum))
    |> fuzz_dsl.with_output(channel_output(output_datum))
    |> fuzz_dsl.with_protocol_validator_check(
        "channel.validate_acknowledge_packet",
        ack_contract(
          input_datum,
          output_datum,
          packet,
          acknowledgement,
          acknowledgement_bytes,
        ),
      )
}

fn run_timeout_packet_transition(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  proof_timestamp: Int,
  mutation: fuzz_dsl.Mutation,
) -> fuzz_dsl.ProtocolTxFixture {
  fuzz_dsl.protocol_tx_fixture(
    fuzz_dsl.model("packet", "timeout"),
    fuzz_dsl.model("packet", "timeout.after"),
    mutation,
  )
    |> fuzz_dsl.with_input(channel_input(input_datum))
    |> fuzz_dsl.with_output(channel_output(output_datum))
    |> fuzz_dsl.with_protocol_validator_check(
        "channel.validate_timeout_packet",
        timeout_contract(input_datum, output_datum, packet, proof_timestamp),
      )
}

fn recv_output(
  input_datum: ChannelDatum,
  packet: Packet,
  ack: ByteArray,
) -> ChannelDatum {
  ChannelDatum {
    ..input_datum,
    state: ChannelDatumState {
      ..input_datum.state,
      packet_receipt: [
        Pair(packet.sequence, ""),
        ..input_datum.state.packet_receipt
      ],
      packet_acknowledgement: [
        Pair(packet.sequence, ack),
        ..input_datum.state.packet_acknowledgement
      ],
    },
  }
}

fn recv_contract(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  ack: ByteArray,
) -> Bool {
  and {
    !pairs.has_key(input_datum.state.packet_receipt, packet.sequence),
    !pairs.has_key(input_datum.state.packet_acknowledgement, packet.sequence),
    packet.destination_port == input_datum.port_id,
    packet.destination_channel == "channel-0",
    packet.source_port == input_datum.state.channel.counterparty.port_id,
    packet.source_channel == input_datum.state.channel.counterparty.channel_id,
    channel_datum_mod.validate_recv_packet(
      input_datum,
      output_datum,
      packet,
      ack,
    ),
  }
}

fn packet_with_commitment(ordering: Order) -> (ChannelDatum, Packet) {
  let packet = base_packet(11)
  let base = base_datum(ordering, packet.sequence + 1)
  let input_datum =
    ChannelDatum {
      ..base,
      state: ChannelDatumState {
        ..base.state,
        packet_commitment: [
          Pair(packet.sequence, packet_mod.commit_packet(packet)),
        ],
      },
    }

  (input_datum, packet)
}

fn ack_output(input_datum: ChannelDatum, packet: Packet) -> ChannelDatum {
  let expected_next_sequence_ack =
    if input_datum.state.channel.ordering == Ordered {
      input_datum.state.next_sequence_ack + 1
    } else {
      input_datum.state.next_sequence_ack
    }

  ChannelDatum {
    ..input_datum,
    state: ChannelDatumState {
      ..input_datum.state,
      next_sequence_ack: expected_next_sequence_ack,
      packet_commitment: pairs.delete_first(
        input_datum.state.packet_commitment,
        packet.sequence,
      ),
    },
  }
}

fn ack_contract(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  acknowledgement: Acknowledgement,
  acknowledgement_bytes: ByteArray,
) -> Bool {
  and {
    acknowledgement_bytes == acknowledgement_mod.marshal_json(acknowledgement),
    channel_datum_mod.validate_acknowledge_packet(
      input_datum,
      output_datum,
      packet,
    ),
  }
}

fn timeout_output(input_datum: ChannelDatum, packet: Packet) -> ChannelDatum {
  let expected_channel_state =
    if input_datum.state.channel.ordering == Ordered {
      Closed
    } else {
      Open
    }

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
}

fn timeout_has_matured(packet: Packet, proof_timestamp: Int) -> Bool {
  packet.timeout_timestamp != 0 && proof_timestamp >= packet.timeout_timestamp
}

fn timeout_contract(
  input_datum: ChannelDatum,
  output_datum: ChannelDatum,
  packet: Packet,
  proof_timestamp: Int,
) -> Bool {
  and {
    timeout_has_matured(packet, proof_timestamp),
    channel_datum_mod.validate_timeout_packet(input_datum, output_datum, packet),
  }
}

test prop_packet_send_accepts_valid_near_context(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.send.valid")

  let packet = base_packet(11)

  packet
    |> build_send_packet_fixture
    |> run_send_packet_transition
    |> fuzz_dsl.assert_protocol_valid
}

test prop_packet_send_rejects_wrong_sequence(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.send.invalid_wrong_sequence")

  let packet = base_packet(11)

  packet
    |> build_send_packet_fixture
    |> mutate_wrong_sequence
    |> run_send_packet_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_packet_send_rejects_missing_commitment_root_update(
  _seed via fuzz.int(),
) {
  fuzz.label(@"contract.packet.send.invalid_missing_commitment_root_update")

  let packet = base_packet(11)

  packet
    |> build_send_packet_fixture
    |> mutate_missing_commitment_root_update
    |> run_send_packet_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_packet_send_rejects_wrong_transfer_callback(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.send.invalid_wrong_transfer_callback")

  let packet = base_packet(11)

  packet
    |> build_send_packet_fixture
    |> mutate_wrong_transfer_callback
    |> run_send_packet_transition
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_packet_recv_accepts_valid_receipt(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.recv.valid_receipt")

  let packet =
    Packet {
      ..base_packet(11),
      source_port: "bank",
      source_channel: "channel-90",
      destination_port: "port-1",
      destination_channel: "channel-0",
    }
  let input_datum = base_datum(Unordered, 1)
  let ack = "ack-commitment"
  let output_datum = recv_output(input_datum, packet, ack)

  run_recv_packet_transition(
    input_datum,
    output_datum,
    packet,
    ack,
    fuzz_dsl.no_mutation(),
  )
    |> fuzz_dsl.assert_protocol_valid
}

test prop_packet_recv_rejects_duplicate_receipt(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.recv.invalid_duplicate_receipt")

  let packet =
    Packet {
      ..base_packet(11),
      source_port: "bank",
      source_channel: "channel-90",
      destination_port: "port-1",
      destination_channel: "channel-0",
    }
  let base = base_datum(Unordered, 1)
  let input_datum =
    ChannelDatum {
      ..base,
      state: ChannelDatumState {
        ..base.state,
        packet_receipt: [Pair(packet.sequence, "")],
      },
    }
  let ack = "ack-commitment"
  let output_datum = recv_output(input_datum, packet, ack)

  run_recv_packet_transition(
    input_datum,
    output_datum,
    packet,
    ack,
    fuzz_dsl.mutation("duplicate_receipt"),
  )
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_packet_ack_accepts_success_ack(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.ack.valid_success")

  let (input_datum, packet) = packet_with_commitment(Unordered)
  let ack = acknowledgement_mod.new_result_acknowledgement("ok")

  run_ack_packet_transition(
    input_datum,
    ack_output(input_datum, packet),
    packet,
    ack,
    acknowledgement_mod.marshal_json(ack),
    fuzz_dsl.no_mutation(),
  )
    |> fuzz_dsl.assert_protocol_valid
}

test prop_packet_ack_accepts_error_ack(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.ack.valid_error")

  let (input_datum, packet) = packet_with_commitment(Unordered)
  let ack = acknowledgement_mod.new_error_acknowledgement("refund")

  run_ack_packet_transition(
    input_datum,
    ack_output(input_datum, packet),
    packet,
    ack,
    acknowledgement_mod.marshal_json(ack),
    fuzz_dsl.no_mutation(),
  )
    |> fuzz_dsl.assert_protocol_valid
}

test prop_packet_ack_rejects_wrong_ack_bytes(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.ack.invalid_wrong_ack_bytes")

  let (input_datum, packet) = packet_with_commitment(Unordered)
  let ack = acknowledgement_mod.new_result_acknowledgement("ok")

  run_ack_packet_transition(
    input_datum,
    ack_output(input_datum, packet),
    packet,
    ack,
    "wrong-ack-bytes",
    fuzz_dsl.mutation("wrong_ack_bytes"),
  )
    |> fuzz_dsl.assert_protocol_rejected
}

test prop_packet_timeout_accepts_unordered(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.timeout.valid_unordered")

  let (input_datum, packet) = packet_with_commitment(Unordered)
  run_timeout_packet_transition(
    input_datum,
    timeout_output(input_datum, packet),
    packet,
    100,
    fuzz_dsl.no_mutation(),
  )
    |> fuzz_dsl.assert_protocol_valid
}

test prop_packet_timeout_accepts_ordered(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.timeout.valid_ordered")

  let (input_datum, packet) = packet_with_commitment(Ordered)
  run_timeout_packet_transition(
    input_datum,
    timeout_output(input_datum, packet),
    packet,
    100,
    fuzz_dsl.no_mutation(),
  )
    |> fuzz_dsl.assert_protocol_valid
}

test prop_packet_timeout_rejects_before_timeout(_seed via fuzz.int()) {
  fuzz.label(@"contract.packet.timeout.invalid_before_timeout")

  let (input_datum, packet) = packet_with_commitment(Unordered)
  run_timeout_packet_transition(
    input_datum,
    timeout_output(input_datum, packet),
    packet,
    99,
    fuzz_dsl.mutation("before_timeout"),
  )
    |> fuzz_dsl.assert_protocol_rejected
}
