use cardano/transaction.{
  Input, Mint, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanCloseInit}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanCloseInit}
use ibc/utils/test_utils
use spending_channel/chan_close_init
use spending_channel/spending_channel_fixture.{MockData, setup}

test chan_close_init_succeed() {
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
  let reference_inputs = [fake_data.connection_input, fake_data.client_input]

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
  let spend_channel_redeemer: Redeemer = ChanCloseInit

  let module_redeemer: Redeemer =
    Callback(OnChanCloseInit { channel_id: fake_data.channel_id })

  let chan_close_init_policy_id_redeemer: Redeemer = fake_data.channel_token

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(fake_data.module_input.output_reference), module_redeemer),
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(
        Mint(fake_data.chan_close_init_policy_id),
        chan_close_init_policy_id_redeemer,
      ),
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

  chan_close_init.chan_close_init.spend(
    fake_data.client_minting_policy_id,
    fake_data.connection_minting_policy_id,
    fake_data.port_minting_policy_id,
    None,
    fake_data.channel_token,
    channel_input.output_reference,
    transaction,
  )
}
