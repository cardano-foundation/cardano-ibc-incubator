use aiken/collection/pairs
use cardano/assets.{from_asset}
use cardano/transaction.{Mint, Redeemer, Spend, Transaction}
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/channel_redeemer.{ChanOpenTry}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/state.{Init, TryOpen}
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanOpenTry}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_025_handler_interface/host_state_redeemer.{CreateChannel}
use ibc/utils/test_utils
use ibc/utils/validator_utils
use minting_channel_stt
use spending_channel/spending_channel_fixture

// Exercise the entire mint policy with an independently encoded proof value.
// Delegated proof verification and the HostState transition are represented by
// their redeemers; this is a policy budget fixture, not a whole-transaction test.
fn check_chan_open_try(ordering, wrong_proof_value) {
  let mock = spending_channel_fixture.setup()
  let proof_height = Height { revision_number: 1, revision_height: 13 }
  expect client: ClientDatum =
    validator_utils.get_inline_datum(mock.client_input.output)
  expect connection: ConnectionDatum =
    validator_utils.get_inline_datum(mock.connection_input.output)
  expect Some(cons_state) =
    pairs.get_first(client.state.consensus_states, proof_height)
  let output_channel =
    Channel {
      state: TryOpen,
      ordering,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-7",
      },
      connection_hops: [mock.connection_id],
      version: "ics20-1",
    }
  let datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: output_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
      },
      port_id: mock.port_id,
      token: mock.channel_token,
    }
  let output = test_utils.build_channel_output(datum, mock.channel_token)
  let expected =
    Channel {
      state: Init,
      ordering,
      counterparty: ChannelCounterparty {
        port_id: mock.port_id,
        channel_id: "",
      },
      connection_hops: [connection.state.counterparty.connection_id],
      version: "ics20-1",
    }
  let proof = MerkleProof { proofs: [] }
  let value =
    if wrong_proof_value {
      #"00"
    } else {
      channel_pb.marshal_for_channel(channel.convert_to_channel_proto(expected)).2nd
    }
  let verification: Redeemer =
    VerifyMembership {
      cs: client.state.client_state,
      cons_state,
      height: proof_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof,
      path: merkle.apply_prefix(
        connection.state.counterparty.prefix,
        merkle.new_merkle_path(
          [channel_keys.channel_path("port-1", "channel-7")],
        ),
      ),
      value,
    }
  let callback: Redeemer =
    Callback(OnChanOpenTry { channel_id: mock.channel_id })
  let host: Redeemer =
    CreateChannel {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
    }
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock.host_state_input, mock.module_input],
      reference_inputs: [mock.connection_input, mock.client_input],
      outputs: [output],
      mint: from_asset(mock.channel_token.policy_id, mock.channel_token.name, 1),
      validity_range: mock.validity_range,
      redeemers: [
        Pair(Spend(mock.host_state_input.output_reference), host),
        Pair(Spend(mock.module_input.output_reference), callback),
        Pair(Mint(mock.verify_proof_policy_id), verification),
      ],
    }
  minting_channel_stt.mint_channel_stt.mint(
    mock.client_minting_policy_id,
    mock.connection_minting_policy_id,
    mock.port_minting_policy_id,
    mock.verify_proof_policy_id,
    "mock spend channel script hash",
    mock.host_state_nft_policy_id,
    "unused shutdown script hash",
    ChanOpenTry {
      counterparty_version: "ics20-1",
      proof_init: proof,
      proof_height,
    },
    mock.channel_minting_policy_id,
    tx,
  )
}

test chan_open_try_mint_ordered_protobuf_budget() {
  check_chan_open_try(Ordered, False)
}

test chan_open_try_mint_unordered_protobuf_budget() {
  check_chan_open_try(Unordered, False)
}

test chan_open_try_mint_rejects_wrong_protobuf_value() {
  !check_chan_open_try(Ordered, True)
}
