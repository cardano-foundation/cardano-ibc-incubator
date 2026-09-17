// Compositional state-machine evidence: an event-log oracle is projected into
// channel state and checked by the production packet datum validators and full
// migration kernel/channel wrapper. This does not simulate counterparty proofs,
// a balanced ledger, or transfer-module mint/burn execution; the two-chain
// rehearsal must supply those separate acceptance checks.
use aiken/builtin
use aiken/collection/list
use aiken/crypto
use aiken/fuzz
use aiken/interval
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{from_script}
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction, placeholder,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_004/types/state.{Open}
use ibc/core/ics_025_handler_interface/host_state.{ModuleRegistration}
use ibc/migration/types.{
  Counts, FixedIdentity, Governance, Implementation, MoveCore, Moving, Registry,
  minimum_delay_ms, registry_token_name,
}
use implementation_registry
use upgradeable/channel as wrapper

type Sent {
  Sent { sequence: Int, data: ByteArray, settled: Bool, generation: Int }
}

type Received {
  Received { sequence: Int, height: Int, pruned: Bool, generation: Int }
}

type Model {
  // The oracle stores facts about events, not the implementation's packet maps.
  Model {
    sent: List<Sent>,
    received: List<Received>,
    floor: Int,
    generation: Int,
    send_count: Int,
    ack_count: Int,
    timeout_count: Int,
    receive_count: Int,
    prune_count: Int,
    old_ack_count: Int,
    old_timeout_count: Int,
    old_prune_count: Int,
  }
}

fn hash(n: Int) -> ByteArray {
  bytearray.from_int_big_endian(n, 28)
}

fn initial() -> Model {
  Model {
    sent: [],
    received: [],
    floor: 0,
    generation: 1,
    send_count: 0,
    ack_count: 0,
    timeout_count: 0,
    receive_count: 0,
    prune_count: 0,
    old_ack_count: 0,
    old_timeout_count: 0,
    old_prune_count: 0,
  }
}

fn token() -> AuthToken {
  AuthToken {
    policy_id: hash(5),
    name: auth.generate_token_name(
      AuthToken { policy_id: hash(2), name: "ibc_host_state" },
      "channel",
      "0",
    ),
  }
}

fn packet(sequence: Int, data: ByteArray) -> Packet {
  Packet {
    sequence,
    data,
    source_port: "transfer",
    source_channel: "channel-0",
    destination_port: "transfer",
    destination_channel: "channel-7",
    timeout_height: Height { revision_number: 0, revision_height: 0 },
    timeout_timestamp: 1_000_000_000_000,
  }
}

fn digest(data: ByteArray) -> ByteArray {
  // Direct ICS-04 commitment encoding, independent of commit_packet.
  crypto.sha2_256(
    bytearray.from_int_big_endian(1_000_000_000_000, 8)
      |> bytearray.concat(bytearray.from_int_big_endian(0, 16))
      |> bytearray.concat(crypto.sha2_256(data)),
  )
}

fn high_water(model: Model) -> Int {
  list.foldl(
    model.received,
    0,
    fn(entry, highest) {
      if entry.height > highest {
        entry.height
      } else {
        highest
      }
    },
  )
}

fn projection(model: Model) -> ChannelDatum {
  let pending =
    list.filter(model.sent, fn(entry) { !entry.settled })
      |> list.sort(fn(a, b) { int.compare(a.sequence, b.sequence) })
  let retained = list.filter(model.received, fn(entry) { !entry.pruned })
  let acknowledgements =
    retained
      |> list.sort(fn(a, b) { int.compare(a.sequence, b.sequence) })
  ChannelDatum {
    token: token(),
    port_id: "transfer",
    state: ChannelDatumState {
      channel: Channel {
        state: Open,
        ordering: Unordered,
        counterparty: ChannelCounterparty {
          port_id: "transfer",
          channel_id: "channel-7",
        },
        connection_hops: ["connection-0"],
        version: "ics20-1",
      },
      next_sequence_send: list.length(model.sent) + 1,
      next_sequence_recv: 1,
      next_sequence_ack: 1,
      packet_commitment: list.map(
        pending,
        fn(entry) { Pair(entry.sequence, digest(entry.data)) },
      ),
      packet_receipt: list.map(retained, fn(entry) { Pair(entry.sequence, "") }),
      packet_acknowledgement: list.map(
        acknowledgements,
        fn(entry) {
          Pair(entry.sequence, crypto.sha2_256("{\"result\":\"AQ==\"}"))
        },
      ),
      minimum_receive_proof_height: Height {
        revision_number: 0,
        revision_height: model.floor,
      },
      maximum_receive_proof_height: Height {
        revision_number: 0,
        revision_height: high_water(model),
      },
    },
  }
}

fn settle(model: Model, selected: Sent, timed_out: Bool) -> Model {
  expect !selected.settled
  let next =
    Model {
      ..model,
      sent: list.map(
        model.sent,
        fn(entry) {
          if entry.sequence == selected.sequence {
            Sent { ..entry, settled: True }
          } else {
            entry
          }
        },
      ),
      ack_count: model.ack_count + if timed_out {
        0
      } else {
        1
      },
      timeout_count: model.timeout_count + if timed_out {
        1
      } else {
        0
      },
      old_ack_count: model.old_ack_count + if !timed_out && selected.generation < model.generation {
        1
      } else {
        0
      },
      old_timeout_count: model.old_timeout_count + if timed_out && selected.generation < model.generation {
        1
      } else {
        0
      },
    }
  let message = packet(selected.sequence, selected.data)
  expect
    if timed_out {
      channel_datum.validate_timeout_packet(
        projection(model),
        projection(next),
        message,
      )
    } else {
      channel_datum.validate_acknowledge_packet(
        projection(model),
        projection(next),
        message,
      )
    }
  next
}

fn prune(model: Model, selected: Received) -> Model {
  expect !selected.pruned
  let next =
    Model {
      ..model,
      floor: high_water(model),
      received: list.map(
        model.received,
        fn(entry) {
          if entry.sequence == selected.sequence {
            Received { ..entry, pruned: True }
          } else {
            entry
          }
        },
      ),
      prune_count: model.prune_count + 1,
      old_prune_count: model.old_prune_count + if selected.generation < model.generation {
        1
      } else {
        0
      },
    }
  expect
    channel_datum.validate_prune_packet_history(
      projection(model),
      projection(next),
      selected.sequence,
      Height { revision_number: 0, revision_height: next.floor },
    )
  next
}

// A choice changes which outstanding claim is settled, not only its amount.
// Empty queues turn into useful sends/receives so generated runs never consist
// of silently skipped transitions.
fn packet_step(model: Model, choice: Int) -> Model {
  let input = projection(model)
  if choice % 5 == 0 {
    let data = bytearray.from_int_big_endian(choice, 4)
    let sequence = list.length(model.sent) + 1
    expect packet.commit_packet(packet(sequence, data)) == digest(data)
    let next =
      Model {
        ..model,
        sent: [
          Sent { sequence, data, settled: False, generation: model.generation },
          ..model.sent
        ],
        send_count: model.send_count + 1,
      }
    expect
      channel_datum.validate_send_packet(
        input,
        projection(next),
        packet(sequence, data),
        digest(data),
      )
    next
  } else if choice % 5 <= 2 {
    let outstanding = list.filter(model.sent, fn(entry) { !entry.settled })
    when outstanding is {
      [] -> packet_step(model, 0)
      _ -> {
        expect Some(selected) =
          list.at(outstanding, choice % list.length(outstanding))
        settle(model, selected, choice % 5 == 2)
      }
    }
  } else if choice % 5 == 3 {
    let sequence = list.length(model.received) + 1
    // Receives vary in proof height and may arrive below the high-water mark,
    // but never below an already authenticated prune floor.
    let proof = model.floor + 1 + choice % 17
    let next =
      Model {
        ..model,
        received: [
          Received {
            sequence,
            height: proof,
            pruned: False,
            generation: model.generation,
          },
          ..model.received
        ],
        receive_count: model.receive_count + 1,
      }
    expect
      channel_datum.validate_recv_packet(
        input,
        projection(next),
        Packet {
          ..packet(sequence, "inbound"),
          source_channel: "channel-7",
          destination_channel: "channel-0",
        },
        crypto.sha2_256("{\"result\":\"AQ==\"}"),
        Height { revision_number: 0, revision_height: proof },
      )
    next
  } else {
    let retained = list.filter(model.received, fn(entry) { !entry.pruned })
    when retained is {
      [] -> packet_step(model, 3)
      _ -> {
        expect Some(selected) =
          list.at(retained, choice % list.length(retained))
        prune(model, selected)
      }
    }
  }
}

fn implementation(generation: Int) -> Implementation {
  Implementation {
    generation,
    addresses: list.map(
      [0, 1, 2, 3, 4],
      fn(role) { from_script(hash(generation * 100 + role)) },
    ),
    compatibility: bytearray.from_int_big_endian(462, 32),
  }
}

fn output(generation: Int, datum: ChannelDatum) -> Output {
  let nft = token()
  Output {
    address: from_script(hash(generation * 100 + 3)),
    value: assets.from_lovelace(8_000_000)
      |> assets.add(nft.policy_id, nft.name, 1),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn reference(n: Int) -> OutputReference {
  OutputReference {
    transaction_id: bytearray.from_int_big_endian(n, 32),
    output_index: 0,
  }
}

fn registry(model: Model, moved: Int) -> Registry {
  Registry {
    token: AuthToken { policy_id: hash(1), name: registry_token_name },
    host_policy: hash(2),
    identity: FixedIdentity {
      client_policy: hash(3),
      connection_policy: hash(4),
      channel_policy: hash(5),
      escrow_policy: hash(6),
      reference_holder: from_script(hash(901)),
    },
    governance: Governance {
      signers: [hash(11)],
      quorum: 1,
      delay_ms: minimum_delay_ms,
    },
    nonce: model.generation,
    current: implementation(model.generation),
    phase: Moving {
      target: implementation(model.generation + 1),
      limits: Counts { clients: 0, connections: 0, channels: 1 },
      next: Counts { clients: 0, connections: 0, channels: moved },
      registration: ModuleRegistration {
        module_script_hash: hash(model.generation * 100 + 4),
        port_token: AuthToken { policy_id: hash(7), name: "transfer" },
        module_token: AuthToken { policy_id: hash(8), name: "module" },
      },
      escrow_remaining: bytearray.from_int_big_endian(0, 32),
      module_moved: True,
    },
  }
}

fn registry_output(state: Registry) -> Output {
  Output {
    address: from_script(hash(900)),
    value: assets.from_lovelace(8_000_000)
      |> assets.add(state.token.policy_id, state.token.name, 1),
    datum: InlineDatum(state),
    reference_script: None,
  }
}

fn channel_handover(model: Model, next_datum: ChannelDatum) -> Bool {
  let datum = projection(model)
  let old = registry(model, 0)
  let action = MoveCore { role: 3 }
  let action_data: Data = action
  let raw = builtin.constr_data(100, [])
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input { output_reference: reference(1), output: registry_output(old) },
        Input {
          output_reference: reference(2),
          output: output(model.generation, datum),
        },
      ],
      outputs: [
        registry_output(registry(model, 1)),
        output(model.generation + 1, next_datum),
      ],
      redeemers: [
        Pair(Spend(reference(1)), action_data),
        Pair(Spend(reference(2)), raw),
      ],
      validity_range: interval.between(1_000, 2_000),
    }
  expect
    implementation_registry.implementation_registry.spend(
      Some(old),
      action,
      reference(1),
      tx,
    )
  expect
    wrapper.channel.spend(
      hash(1),
      model.generation,
      hash(2),
      [],
      Some(datum),
      raw,
      reference(2),
      tx,
    )
  True
}

fn migrate(model: Model) -> Model {
  let datum = projection(model)
  expect channel_handover(model, datum)
  // The channel model resumes only after the separately tested kernel's
  // completion/activation transition. This isolated property cannot authorize it.
  let next = Model { ..model, generation: model.generation + 1 }
  expect projection(next) == datum
  next
}

// Identify old packets explicitly: random choices cannot accidentally satisfy
// post-handover coverage by settling only traffic created after the handover.
fn handover_with_old_claims(model: Model) -> Model {
  let pending = packet_step(packet_step(packet_step(model, 20), 25), 13)
  expect [timeout_claim, ack_claim, ..] = pending.sent
  expect [receipt, ..] = pending.received
  let moved = migrate(pending)
  let after_ack = settle(moved, ack_claim, False)
  let after_timeout = settle(after_ack, timeout_claim, True)
  let after_prune = prune(after_timeout, receipt)
  expect after_prune.ack_count == model.ack_count + 1
  expect after_prune.timeout_count == model.timeout_count + 1
  expect after_prune.prune_count == model.prune_count + 1
  expect after_prune.old_ack_count == model.old_ack_count + 1
  expect after_prune.old_timeout_count == model.old_timeout_count + 1
  expect after_prune.old_prune_count == model.old_prune_count + 1
  after_prune
}

fn run(choices: List<Int>) -> Model {
  // Two authenticated channel moves, assuming separately tested activation.
  // Every run exercises old ack/timeout/prune transitions after both moves.
  let prefix = list.foldl(choices, initial(), fn(c, m) { packet_step(m, c) })
  let middle =
    list.foldl(
      list.reverse(choices),
      handover_with_old_claims(prefix),
      fn(c, m) { packet_step(m, c) },
    )
  let final = handover_with_old_claims(middle)
  expect
    final.ack_count >= 2 && final.timeout_count >= 2 && final.prune_count >= 2
  final
}

test prop_migration_packet_event_log_model(
  choices via fuzz.list_between(fuzz.int_between(0, 999), 8, 12),
) {
  let result = run(choices)
  // Labels count completed histories, never repeated operations within one
  // history. The fixed handovers guarantee these scenarios; they do not attest
  // to random generator diversity. Each count follows accepted datum/kernel
  // checks above, including explicit identification of pre-handover claims.
  expect result.send_count >= 4 && result.receive_count >= 2
  expect
    result.ack_count >= 2 && result.timeout_count >= 2 && result.prune_count >= 2
  expect
    result.old_ack_count >= 2 && result.old_timeout_count >= 2 && result.old_prune_count >= 2
  expect result.generation == 3
  fuzz.label(@"fuzz.model.migration.send")
  fuzz.label(@"fuzz.model.migration.receive")
  fuzz.label(@"fuzz.model.migration.acknowledge")
  fuzz.label(@"fuzz.model.migration.timeout")
  fuzz.label(@"fuzz.model.migration.prune")
  fuzz.label(@"fuzz.model.migration.old-ack-after-handover")
  fuzz.label(@"fuzz.model.migration.old-timeout-after-handover")
  fuzz.label(@"fuzz.model.migration.old-receipt-pruned-after-handover")
  fuzz.label(@"fuzz.model.migration.authenticated-channel-handover")
  result.generation == 3 && projection(result).state.next_sequence_send == result.send_count + 1
}

test migration_packet_event_log_regression_462() {
  run([462, 611, 737, 408, 631, 614, 629, 632, 10, 998]).generation == 3
}

fn retained_claims() -> Model {
  list.foldl([0, 5, 3, 8, 4], initial(), fn(c, m) { packet_step(m, c) })
}

fn corrupted_handover(choice: Int) -> Bool {
  let model = retained_claims()
  let datum = projection(model)
  // Positive control uses exactly the same registry, object and transaction.
  expect channel_handover(model, datum)
  let mutated =
    ChannelDatum {
      ..datum,
      state: when choice is {
        0 -> {
          fuzz.label(@"fuzz.model.migration.reject-commitment-omission")
          ChannelDatumState { ..datum.state, packet_commitment: [] }
        }
        1 -> {
          fuzz.label(@"fuzz.model.migration.reject-receipt-omission")
          ChannelDatumState { ..datum.state, packet_receipt: [] }
        }
        2 -> {
          fuzz.label(@"fuzz.model.migration.reject-acknowledgement-omission")
          ChannelDatumState { ..datum.state, packet_acknowledgement: [] }
        }
        _ -> {
          fuzz.label(@"fuzz.model.migration.reject-proof-floor-mutation")
          ChannelDatumState {
            ..datum.state,
            minimum_receive_proof_height: Height {
              revision_number: 0,
              revision_height: model.floor + 1,
            },
          }
        }
      },
    }
  expect mutated != datum
  channel_handover(model, mutated)
}

test prop_migration_packet_handover_rejects_claim_mutation(
  choice via fuzz.int_between(0, 3),
) fail {
  corrupted_handover(choice)
}

test migration_packet_handover_rejects_commitment_omission() fail {
  corrupted_handover(0)
}

test migration_packet_receive_preserves_prune_floor() {
  let old = retained_claims()
  let model = migrate(old)
  let before = projection(model)
  let next = packet_step(model, 3)
  expect model.floor > 0
  let projected = projection(next)
  let output =
    ChannelDatum {
      ..projected,
      state: ChannelDatumState {
        ..projected.state,
        maximum_receive_proof_height: before.state.maximum_receive_proof_height,
      },
    }
  let message =
    Packet {
      ..packet(list.length(model.received) + 1, "inbound"),
      source_channel: "channel-7",
      destination_channel: "channel-0",
    }
  // At the floor the identical output is valid; below it only the replay-floor
  // condition changes. An unrelated high-water mismatch cannot reject it.
  expect
    channel_datum.validate_recv_packet(
      before,
      output,
      message,
      crypto.sha2_256("{\"result\":\"AQ==\"}"),
      Height { revision_number: 0, revision_height: model.floor },
    )
  !channel_datum.validate_recv_packet(
    before,
    output,
    message,
    crypto.sha2_256("{\"result\":\"AQ==\"}"),
    Height { revision_number: 0, revision_height: model.floor - 1 },
  )
}

test migration_packet_send_rejects_sequence_change_after_handover() {
  let model = migrate(retained_claims())
  let next = packet_step(model, 10)
  let correct = projection(next)
  let bad =
    ChannelDatum {
      ..correct,
      state: ChannelDatumState {
        ..correct.state,
        next_sequence_send: correct.state.next_sequence_send + 1,
      },
    }
  !channel_datum.validate_send_packet(
    projection(model),
    bad,
    packet(list.length(model.sent) + 1, bytearray.from_int_big_endian(10, 4)),
    digest(bytearray.from_int_big_endian(10, 4)),
  )
}
