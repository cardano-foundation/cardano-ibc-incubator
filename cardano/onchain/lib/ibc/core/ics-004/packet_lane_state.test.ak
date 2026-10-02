use aiken/collection/list
use cardano/address
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Transaction,
}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/packet_lane_datum.{
  CommitPacket, LaneUpdate, PacketLaneDatum,
}
use ibc/core/ics_004/packet_lane_state
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/testing/sparse_tree

const policy = #"11111111111111111111111111111111111111111111111111111111"

fn prepared(sequence: Int) -> (Transaction, OutputReference, List<LaneUpdate>) {
  let lane = packet_lanes.packet_lane("transfer", "channel-0", sequence, 16)
  let old = packet_lane_datum.empty("transfer", "channel-0", lane, 16)
  let packet =
    Packet {
      sequence,
      source_port: "transfer",
      source_channel: "channel-0",
      destination_port: "transfer",
      destination_channel: "channel-1",
      data: "same asset transfer",
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1_000_000_000,
    }
  let key =
    packet_keys.packet_commitment_path("transfer", "channel-0", sequence)
  let updates =
    [
      LaneUpdate {
        mutation: CommitPacket { packet },
        siblings: [sparse_tree.siblings([], key)],
      },
    ]
  let output =
    Output {
      address: address.from_script(policy),
      value: assets.from_asset(
        policy,
        packet_lanes.lane_token_name("transfer", "channel-0", lane, 16),
        1,
      )
        |> assets.add("", "", 2_000_000),
      datum: InlineDatum(old),
      reference_script: None,
    }
  let ref =
    OutputReference {
      transaction_id: #"abababababababababababababababababababababababababababababababab",
      output_index: lane,
    }
  (
    Transaction {
      ..transaction.placeholder,
      inputs: [Input { output_reference: ref, output }],
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(packet_lane_datum.apply_updates(old, updates)),
        },
      ],
    },
    ref,
    updates,
  )
}

test packet_lane_state_five_updates_have_disjoint_state_inputs() {
  let transactions = list.map([1, 2, 3, 4, 5], prepared)
  let refs =
    list.map(
      transactions,
      fn(item) {
        let (_, ref, _) = item
        ref
      },
    )
  and {
    list.length(list.unique(refs)) == 5,
    list.all(
      transactions,
      fn(item) {
        let (tx, ref, updates) = item
        packet_lane_state.validate_transition(tx, ref, policy, updates)
      },
    ),
  }
}

test packet_lane_state_rejects_duplicate_successor() fail {
  let (tx, ref, updates) = prepared(1)
  expect [output] = tx.outputs
  packet_lane_state.validate_transition(
    Transaction { ..tx, outputs: [output, output] },
    ref,
    policy,
    updates,
  )
}

test packet_lane_state_rejects_forged_root() {
  let (tx, ref, updates) = prepared(1)
  expect [output] = tx.outputs
  expect InlineDatum(raw) = output.datum
  expect datum: PacketLaneDatum = raw
  !packet_lane_state.validate_transition(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(
            PacketLaneDatum {
              ..datum,
              root: #"0000000000000000000000000000000000000000000000000000000000000000",
            },
          ),
        },
      ],
    },
    ref,
    policy,
    updates,
  )
}

test packet_lane_state_rejects_identity_mint_during_update() fail {
  let (tx, ref, updates) = prepared(1)
  let name = packet_lanes.lane_token_name("transfer", "channel-0", 1, 16)
  packet_lane_state.validate_transition(
    Transaction { ..tx, mint: assets.from_asset(policy, name, 1) },
    ref,
    policy,
    updates,
  )
}

test packet_lane_state_rejects_identity_removed_from_input() fail {
  let (tx, ref, updates) = prepared(1)
  expect [input] = tx.inputs
  let name = packet_lanes.lane_token_name("transfer", "channel-0", 1, 16)
  packet_lane_state.validate_transition(
    Transaction {
      ..tx,
      inputs: [
        Input {
          ..input,
          output: Output {
            ..input.output,
            value: assets.add(input.output.value, policy, name, -1),
          },
        },
      ],
    },
    ref,
    policy,
    updates,
  )
}

const accounting_key =
  #"abababababababababababababababababababababababababababababababab"

fn compaction() -> (Transaction, OutputReference, OutputReference) {
  let (left, left_ref, _) = prepared(1)
  let (right, right_ref, _) = prepared(2)
  expect [a] = left.inputs
  expect [b] = right.inputs
  expect InlineDatum(raw_a) = a.output.datum
  expect InlineDatum(raw_b) = b.output.datum
  expect old_a: PacketLaneDatum = raw_a
  expect old_b: PacketLaneDatum = raw_b
  (
    Transaction {
      ..transaction.placeholder,
      inputs: [
        Input {
          ..a,
          output: Output {
            ..a.output,
            datum: InlineDatum(
              PacketLaneDatum { ..old_a, balances: [Pair(accounting_key, 10)] },
            ),
          },
        },
        Input {
          ..b,
          output: Output {
            ..b.output,
            datum: InlineDatum(
              PacketLaneDatum { ..old_b, balances: [Pair(accounting_key, -10)] },
            ),
          },
        },
      ],
      outputs: [
        Output {
          ..a.output,
          datum: InlineDatum(PacketLaneDatum { ..old_a, version: 1 }),
        },
        Output {
          ..b.output,
          datum: InlineDatum(PacketLaneDatum { ..old_b, version: 1 }),
        },
      ],
    },
    left_ref,
    right_ref,
  )
}

test balance_compaction_cancels_cross_lane_round_trip() {
  let (tx, left, right) = compaction()
  packet_lane_state.compact_balances(operation_policy, tx, left, right, policy) && packet_lane_state.compact_balances(
    operation_policy,
    tx,
    right,
    left,
    policy,
  )
}

test balance_compaction_rejects_unbacked_obligation_removal() {
  let (tx, left, right) = compaction()
  expect [a, b] = tx.inputs
  expect InlineDatum(raw) = b.output.datum
  expect old: PacketLaneDatum = raw
  let forged =
    Input {
      ..b,
      output: Output {
        ..b.output,
        datum: InlineDatum(PacketLaneDatum { ..old, balances: [] }),
      },
    }
  !packet_lane_state.compact_balances(
    operation_policy,
    Transaction { ..tx, inputs: [a, forged] },
    left,
    right,
    policy,
  )
}

test balance_compaction_rejects_changed_packet_root() fail {
  let (tx, left, right) = compaction()
  expect [a, b] = tx.outputs
  expect InlineDatum(raw) = a.datum
  expect old: PacketLaneDatum = raw
  packet_lane_state.compact_balances(
    operation_policy,
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..a,
          datum: InlineDatum(PacketLaneDatum { ..old, root: accounting_key }),
        },
        b,
      ],
    },
    left,
    right,
    policy,
  )
}

test balance_compaction_rejects_counterfeit_identity() fail {
  let (tx, left, right) = compaction()
  expect [a, b] = tx.inputs
  packet_lane_state.compact_balances(
    operation_policy,
    Transaction {
      ..tx,
      inputs: [
        a,
        Input {
          ..b,
          output: Output { ..b.output, value: assets.from_lovelace(2_000_000) },
        },
      ],
    },
    left,
    right,
    policy,
  )
}

test balance_compaction_rejects_duplicate_continuation() fail {
  let (tx, left, right) = compaction()
  expect [a, b] = tx.outputs
  packet_lane_state.compact_balances(
    operation_policy,
    Transaction { ..tx, outputs: [a, a, b] },
    left,
    right,
    policy,
  )
}

const operation_policy =
  #"22222222222222222222222222222222222222222222222222222222"

test balance_compaction_cannot_replace_packet_execution() fail {
  let (tx, left, right) = compaction()
  let operation: Data = #""
  packet_lane_state.compact_balances(
    operation_policy,
    Transaction { ..tx, redeemers: [Pair(Mint(operation_policy), operation)] },
    left,
    right,
    policy,
  )
}

test packet_update_rejects_a_canonical_but_unearned_balance() {
  let (tx, ref, updates) = prepared(1)
  expect [output] = tx.outputs
  expect InlineDatum(raw) = output.datum
  expect new: PacketLaneDatum = raw
  !packet_lane_state.validate_transition(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..output,
          datum: InlineDatum(
            PacketLaneDatum { ..new, balances: [Pair(accounting_key, 1)] },
          ),
        },
      ],
    },
    ref,
    policy,
    updates,
  )
}

// Each nominated pair sums to zero, but the three inputs sum to +10.
// The same negative balance must not cancel both positive inputs.
test balance_compaction_rejects_overlapping_three_lane_pairs() fail {
  let (tx, left, right) = compaction()
  let (third, _, _) = prepared(3)
  expect [input] = third.inputs
  expect InlineDatum(raw) = input.output.datum
  expect old: PacketLaneDatum = raw
  packet_lane_state.compact_balances(
    operation_policy,
    Transaction {
      ..tx,
      inputs: [
        Input {
          ..input,
          output: Output {
            ..input.output,
            datum: InlineDatum(
              PacketLaneDatum { ..old, balances: [Pair(accounting_key, 10)] },
            ),
          },
        },
        ..tx.inputs
      ],
      outputs: [
        Output {
          ..input.output,
          datum: InlineDatum(PacketLaneDatum { ..old, version: 1 }),
        },
        ..tx.outputs
      ],
    },
    left,
    right,
    policy,
  )
}

test balance_compaction_rejects_pending_refund_reservations() fail {
  let (tx, left, right) = compaction()
  expect [a, b] = tx.inputs
  expect [out_a, out_b] = tx.outputs
  expect InlineDatum(raw) = a.output.datum
  expect old: PacketLaneDatum = raw
  let pending =
    PacketLaneDatum { ..old, commitments: [Pair(1, accounting_key)] }
  packet_lane_state.compact_balances(
    operation_policy,
    Transaction {
      ..tx,
      inputs: [
        Input {
          ..a,
          output: Output { ..a.output, datum: InlineDatum(pending) },
        },
        b,
      ],
      outputs: [
        Output {
          ..out_a,
          datum: InlineDatum(
            PacketLaneDatum { ..pending, version: 1, balances: [] },
          ),
        },
        out_b,
      ],
    },
    left,
    right,
    policy,
  )
}
