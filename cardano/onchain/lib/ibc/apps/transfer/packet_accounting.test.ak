use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use cardano/address
use cardano/assets
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use ibc/apps/transfer/packet_accounting
use ibc/apps/transfer/packet_batch.{
  Acknowledge, LaneInputUpdate, Receive, Reject, SendBatch, Timeout,
  TransferIntent,
}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/packet_balances
use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}

const denom = "transfer/channel-0/X"

const ref =
  OutputReference {
    transaction_id: #"abababababababababababababababababababababababababababababababab",
    output_index: 0,
  }

const height = Height { revision_number: 0, revision_height: 0 }

const proof = MerkleProof { proofs: [] }

const lane = LaneInputUpdate { input_ref: ref, updates: [] }

const data =
  FungibleTokenPacketData {
    denom,
    amount: "10",
    sender: "alice",
    receiver: "bob",
    memo: "",
  }

const packet =
  Packet {
    sequence: 1,
    source_port: "transfer",
    source_channel: "channel-0",
    destination_port: "transfer",
    destination_channel: "channel-7",
    data: "",
    timeout_height: height,
    timeout_timestamp: 1,
  }

fn burned() -> PacketLaneDatum {
  let old = packet_lane_datum.empty("transfer", "channel-0", 1, 16)
  let balances =
    list.map(
      ["A", "B", "C", "D", "E", "F", "G", denom],
      fn(d) { Pair(crypto.sha2_256(d), 10) },
    )
  let intent =
    TransferIntent {
      port_id: "transfer",
      channel_id: "channel-0",
      owner: "",
      data,
      timeout_timestamp: 1,
    }
  let tx =
    transaction.Transaction {
      ..transaction.placeholder,
      inputs: [
        Input {
          output_reference: ref,
          output: Output {
            address: address.from_verification_key(#""),
            value: assets.zero,
            datum: InlineDatum(intent),
            reference_script: None,
          },
        },
      ],
    }
  let next =
    packet_accounting.balance_after(
      tx,
      PacketLaneDatum { ..old, balances },
      SendBatch {
        sequencer_ref: ref,
        intents: [ref],
        packets: [packet],
        lanes: [lane],
      },
    )
  PacketLaneDatum { ..old, balances: next, commitments: [Pair(1, #"ab")] }
}

test full_capacity_burn_reserves_slot_against_a_new_asset() {
  let old = burned()
  let next =
    packet_accounting.balance_after(
      transaction.placeholder,
      old,
      Receive {
        packet,
        data: FungibleTokenPacketData { ..data, denom: "Y" },
        proof_height: height,
        proof,
        lane,
        liquidity_refs: [],
      },
    )
  list.length(old.balances) == 8 && pairs.get_first(
    old.balances,
    crypto.sha2_256(denom),
  ) == Some(0) && !packet_balances.within_capacity(next)
}

test full_capacity_timeout_restores_reserved_slot() {
  let next =
    packet_accounting.balance_after(
      transaction.placeholder,
      burned(),
      Timeout {
        packet,
        data,
        proof_height: height,
        proof,
        lane,
        liquidity_refs: [],
      },
    )
  list.length(next) == 8 && pairs.get_first(next, crypto.sha2_256(denom)) == Some(
    10,
  ) && packet_balances.within_capacity(next)
}

test full_capacity_error_ack_restores_reserved_slot() {
  let next =
    packet_accounting.balance_after(
      transaction.placeholder,
      burned(),
      Reject {
        packet,
        data,
        err: "rejected",
        proof_height: height,
        proof,
        lane,
        liquidity_refs: [],
      },
    )
  list.length(next) == 8 && pairs.get_first(next, crypto.sha2_256(denom)) == Some(
    10,
  ) && packet_balances.within_capacity(next)
}

test successful_last_ack_releases_reservation() {
  let next =
    packet_accounting.balance_after(
      transaction.placeholder,
      burned(),
      Acknowledge { packet, proof_height: height, proof, lane },
    )
  list.length(next) == 7 && pairs.get_first(next, crypto.sha2_256(denom)) == None
}

test partial_ack_keeps_reservation_for_other_unresolved_sends() {
  let old = burned()
  let next =
    packet_accounting.balance_after(
      transaction.placeholder,
      PacketLaneDatum { ..old, commitments: [Pair(1, #"ab"), Pair(17, #"cd")] },
      Acknowledge { packet, proof_height: height, proof, lane },
    )
  next == old.balances
}
