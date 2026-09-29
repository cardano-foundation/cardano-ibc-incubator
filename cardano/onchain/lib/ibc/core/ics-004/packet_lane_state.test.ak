use aiken/collection/list
use cardano/address
use cardano/assets
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
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
