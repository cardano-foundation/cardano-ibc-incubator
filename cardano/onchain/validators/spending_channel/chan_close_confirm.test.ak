use cardano/transaction.{
  Input, Mint, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanCloseConfirm}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanOpenConfirm}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel/chan_close_confirm
use spending_channel/spending_channel_fixture.{MockData, setup}

test chan_close_confirm_succeed() {
  let fake_data = setup()

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: chan_state_mod.Open,
      ordering: chan_order_mod.Ordered,
      counterparty: ChannelCounterparty {
        port_id: "fake port",
        channel_id: "fake channel",
      },
      connection_hops: [fake_data.connection_id],
      version: "fake version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel: input_channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: fake_data.port_id,
      token: fake_data.channel_token,
    }

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, fake_data.channel_token)

  let inputs = [fake_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let proof_cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"",
      root: MerkleRoot { hash: #"" },
    }

  let client_input =
    test_utils.update_client(
      proof_height,
      proof_cons_state,
      fake_data.client_input,
    )

  let reference_inputs = [fake_data.connection_input, client_input]

  //========================arrange outputs=======================
  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        channel: Channel {
          ..input_channel_datum.state.channel,
          state: chan_state_mod.Closed,
        },
      },
    }

  let channel_output =
    test_utils.build_channel_output(
      output_channel_datum,
      fake_data.channel_token,
    )

  let outputs = [channel_output]

  //========================arrange validity_range=======================
  let validity_range = fake_data.validity_range

  //========================arrange redeemers=======================
  let proof_init = MerkleProof { proofs: [] }

  let spend_channel_redeemer: Redeemer =
    ChanCloseConfirm { proof_init, proof_height }

  let module_redeemer: Redeemer =
    Callback(OnChanOpenConfirm { channel_id: fake_data.channel_id })

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(fake_data.connection_input.output)

  let connection = connection_datum.state

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          channel_keys.channel_path(
            output_channel_datum.state.channel.counterparty.port_id,
            output_channel_datum.state.channel.counterparty.channel_id,
          ),
        ],
      ),
    )

  let counterparty_hops = [connection.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty {
      port_id: output_channel_datum.port_id,
      channel_id: fake_data.channel_id,
    }

  let expected_channel =
    Channel {
      state: chan_state_mod.Closed,
      ordering: output_channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: output_channel_datum.state.channel.version,
    }

  let channel_bz =
    channel_pb.marshal_for_channel(
      Some(channel.convert_to_channel_proto(expected_channel)),
    )

  let verify_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: client_datum.state.client_state,
      cons_state: proof_cons_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_init,
      path: merkle_path,
      value: channel_bz,
    }

  let chan_close_confirm_redeemer: Redeemer = fake_data.channel_token

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(fake_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(
        Mint(fake_data.chan_close_confirm_policy_id),
        chan_close_confirm_redeemer,
      ),
      Pair(Mint(fake_data.verify_proof_policy_id), verify_proof_redeemer),
    ]

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: inputs,
      reference_inputs: reference_inputs,
      outputs: outputs,
      redeemers: redeemers,
      validity_range: validity_range,
    }

  chan_close_confirm.chan_close_confirm.spend(
    fake_data.client_minting_policy_id,
    fake_data.connection_minting_policy_id,
    fake_data.port_minting_policy_id,
    fake_data.verify_proof_policy_id,
    None,
    fake_data.channel_token,
    channel_input.output_reference,
    transaction,
  )
}
