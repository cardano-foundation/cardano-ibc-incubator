use cardano/assets
use cardano/transaction.{Transaction, placeholder}
use ibc/apps/transfer/packet_batch.{
  Acknowledge, AcknowledgeBatch, AuthorizedOperation, BatchOperation, Receive,
  SendBatch,
}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/packet.{Packet}
use packet_lane_batch.{OperationPolicies}

const channel_policy =
  #"11111111111111111111111111111111111111111111111111111111"

const batch_policy = #"22222222222222222222222222222222222222222222222222222222"

const policies =
  OperationPolicies {
    send: #"33333333333333333333333333333333333333333333333333333333",
    acknowledge: #"44444444444444444444444444444444444444444444444444444444",
    timeout: #"55555555555555555555555555555555555555555555555555555555",
    reject: #"66666666666666666666666666666666666666666666666666666666",
    receive: #"77777777777777777777777777777777777777777777777777777777",
    timeout_on_close: #"88888888888888888888888888888888888888888888888888888888",
    retire: #"99999999999999999999999999999999999999999999999999999999",
    funds: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    send_funds: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }

fn acknowledgement() -> BatchOperation {
  Acknowledge {
    packet: Packet {
      sequence: 1,
      source_port: "transfer",
      source_channel: "channel-0",
      destination_port: "transfer",
      destination_channel: "channel-7",
      data: "packet",
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1,
    },
    proof_height: Height { revision_number: 1, revision_height: 10 },
    proof_index: 0,
    lane: packet_batch.LaneInputUpdate {
      input_ref: transaction.OutputReference {
        transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
        output_index: 0,
      },
      updates: [],
    },
  }
}

fn dispatch(op: BatchOperation, mint: assets.Value) -> Bool {
  packet_lane_batch.packet_lane_batch.mint(
    channel_policy,
    policies,
    AuthorizedOperation {
      channel_token: AuthToken { policy_id: channel_policy, name: "channel" },
      operation: op,
      history_witness: None,
    },
    batch_policy,
    Transaction { ..placeholder, mint },
  )
}

test successful_acknowledgement_dispatch_needs_no_funds_policy() {
  dispatch(acknowledgement(), assets.from_asset(policies.acknowledge, "", 1))
}

test successful_acknowledgement_batch_dispatch_needs_no_funds_policy() {
  dispatch(
    AcknowledgeBatch { packets: [acknowledgement(), acknowledgement()] },
    assets.from_asset(policies.acknowledge, "", 1),
  )
}

test successful_acknowledgement_dispatch_requires_its_verifier() {
  !dispatch(acknowledgement(), assets.from_asset(policies.funds, "", 1))
}

test successful_acknowledgement_dispatch_rejects_extra_verifier_assets() {
  !dispatch(
    acknowledgement(),
    assets.from_asset(policies.acknowledge, "", 1)
      |> assets.add(policies.acknowledge, "extra", 1),
  )
}

test send_dispatch_still_requires_its_funds_policy() fail {
  expect _ =
    dispatch(
      SendBatch {
        sequencer_ref: transaction.OutputReference {
          transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
          output_index: 0,
        },
        intents: [],
        packets: [],
        lanes: [],
      },
      assets.from_asset(policies.send, "", 1),
    )
}

test receive_dispatch_still_requires_its_funds_policy() fail {
  expect Acknowledge { packet, proof_height, proof_index, lane } =
    acknowledgement()
  expect _ =
    dispatch(
      Receive {
        packet,
        proof_height,
        proof_index,
        lane,
        data: FungibleTokenPacketData {
          denom: "lovelace",
          amount: "1",
          sender: "sender",
          receiver: "receiver",
          memo: "",
        },
        liquidity_refs: [],
      },
      assets.from_asset(policies.receive, "", 1),
    )
}
