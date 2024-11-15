use cardano/address.{from_script}
use cardano/assets.{from_asset}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/utils/validator_utils

pub fn build_channel_output(
  channel_datum: ChannelDatum,
  channel_token: AuthToken,
) -> Output {
  let channel_output =
    Output {
      address: from_script("mock spend channel script hash"),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(channel_datum),
      reference_script: None,
    }

  channel_output
}

pub fn build_channel_input(
  channel_datum: ChannelDatum,
  channel_token: AuthToken,
) -> Input {
  let channel_output = build_channel_output(channel_datum, channel_token)

  let channel_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: channel_output,
    }

  channel_input
}

pub fn update_client(
  height: Height,
  consensus_state: ConsensusState,
  client_input: Input,
) -> Input {
  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)

  let latest_height = {
    let input_height =
      client_state.get_latest_height(client_datum.state.client_state)
    if height_mod.compare(height, input_height) == Greater {
      height
    } else {
      input_height
    }
  }

  let client_datum =
    ClientDatum {
      ..client_datum,
      state: ClientDatumState {
        client_state: ClientState {
          ..client_datum.state.client_state,
          latest_height: latest_height,
        },
        consensus_states: [
          Pair(height, consensus_state),
          ..client_datum.state.consensus_states
        ],
      },
    }

  let updated_input =
    Input {
      ..client_input,
      output: Output { ..client_input.output, datum: InlineDatum(client_datum) },
    }

  updated_input
}

pub fn send_packet(packet: Packet, channel_datum: ChannelDatum) -> ChannelDatum {
  expect packet.sequence == channel_datum.state.next_sequence_send

  let commitment = packet_mod.commit_packet(packet)

  ChannelDatum {
    ..channel_datum,
    state: ChannelDatumState {
      ..channel_datum.state,
      next_sequence_send: channel_datum.state.next_sequence_send + 1,
      packet_commitment: [
        Pair(packet.sequence, commitment),
        ..channel_datum.state.packet_commitment
      ],
    },
  }
}
