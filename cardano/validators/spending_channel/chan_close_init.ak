use aiken/collection/list
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{PolicyId, Value, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, TransactionId, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanCloseInit}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanCloseInit}
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/utils/test_utils
use ibc/utils/validator_utils

validator chan_close_init(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
) {
  spend(
    _datum: Option<Data>,
    channel_token: AuthToken,
    spent_output: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = transaction

    expect Some((datum, channel_redeemer, spent_output)) =
      validator_utils.extract_channel(inputs, redeemers, channel_token)

    expect auth.contain_auth_token(spent_output, datum.token)

    expect [updated_output] =
      list.filter(
        outputs,
        fn(output) { output.address == spent_output.address },
      )
    expect updated_datum: ChannelDatum =
      validator_utils.get_inline_datum(updated_output)

    expect auth.contain_auth_token(updated_output, datum.token)

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)

    expect [connection_id] = datum.state.channel.connection_hops

    expect Some(channel_sequence) =
      auth.extract_token_sequence(datum.token.name)
    let channel_id = chan_keys_mod.format_channel_identifier(channel_sequence)

    expect ChanCloseInit == channel_redeemer

    trace @"chan_close_init: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState { channel: cur_channel, .. } = cur_channel_state

    expect cur_channel.state != chan_state_mod.Closed
    trace @"chan_close_init: channel state is not Closed"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"chan_close_init: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"chan_close_init: Connection is open"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"chan_close_init: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"chan_close_init: client status is active"

    expect channel_datum_mod.validate_chan_close_init(datum, updated_datum)
    trace @"chan_close_init: channel_datum is updated valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect ibc_module_callback == OnChanCloseInit { channel_id }
    trace @"chan_close_init: ibc module callback is valid"

    True
  }

  else(_) {
    fail
  }
}

//==========================================Test================================================
type MockData {
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  chan_close_init_policy_id: PolicyId,
  channel_id: ByteArray,
  channel_token: AuthToken,
  connection_id: ByteArray,
  connection_input: Input,
  client_input: Input,
  validity_range: ValidityRange,
  port_id: ByteArray,
  module_input: Input,
}

fn setup() -> MockData {
  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  //========================Channel============================
  let channel_sequence = "0"
  let channel_id = "channel-0"

  let channel_token_name =
    auth.generate_token_name(
      handler_token,
      chan_keys_mod.channel_prefix,
      channel_sequence,
    )

  let channel_token =
    AuthToken {
      policy_id: "fake channel minting policy id",
      name: channel_token_name,
    }

  //========================Connection============================
  let client_id = "ibc_client-0"
  let client_sequence = "0"

  let connection_id = "connection-0"
  let connection_sequence = "0"

  let connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
        client_id,
        versions: [],
        state: conn_state_mod.Open,
        counterparty: Counterparty {
          client_id: "",
          connection_id: "",
          prefix: MerklePrefix { key_prefix: "" },
        },
        delay_period: 0,
      },
      token: AuthToken { name: "", policy_id: "" },
    }

  let connection_token_name =
    auth.generate_token_name(
      handler_token,
      conn_keys_mod.connection_prefix,
      connection_sequence,
    )

  let connection_minting_policy_id = "fake connection minting policy id"

  let connection_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock connection script hash"),
        value: from_asset(
          connection_minting_policy_id,
          connection_token_name,
          1,
        ),
        datum: InlineDatum(connection_datum),
        reference_script: None,
      },
    }

  //========================Client============================
  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"",
      root: MerkleRoot { hash: #"" },
    }

  let consensus_state_height =
    Height { revision_number: 1, revision_height: 13 }

  let client_state =
    ClientState {
      chain_id: "",
      trust_level: unchecked_rational.new(1, 3),
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: consensus_state_height,
      proof_specs: [],
    }

  let client_token_name =
    auth.generate_token_name(
      handler_token,
      client_keys_mod.client_prefix,
      client_sequence,
    )

  let client_minting_policy_id = "fake client minting policy id"

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: [Pair(consensus_state_height, cons_state)],
      },
      token: AuthToken { policy_id: "", name: "" },
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock client script hash"),
        value: from_asset(client_minting_policy_id, client_token_name, 1),
        datum: InlineDatum(client_datum),
        reference_script: None,
      },
    }

  //==========================ValidityRange===========================
  let valid_to =
    ( cons_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1
  let validity_range = interval.before(valid_to)

  //==========================Module===========================
  let port_minting_policy_id = "fake port minting policy id"

  let port_id = "port-1"
  let port_number = "1"

  let port_token_name =
    auth.generate_token_name(
      handler_token,
      port_keys_mod.port_prefix,
      port_number,
    )

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("fake module script hash"),
        value: from_asset(port_minting_policy_id, port_token_name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  MockData {
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    chan_close_init_policy_id: "fake chan close init policy id",
    channel_id,
    channel_token,
    connection_id,
    connection_input,
    client_input,
    validity_range,
    port_id,
    module_input,
  }
}

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

  let inputs =
    [fake_data.module_input, channel_input]

  //========================arrange reference_inputs=======================
  let reference_inputs =
    [fake_data.connection_input, fake_data.client_input]

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

  let outputs =
    [channel_output]

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

  chan_close_init.spend(
    fake_data.client_minting_policy_id,
    fake_data.connection_minting_policy_id,
    fake_data.port_minting_policy_id,
    None,
    fake_data.channel_token,
    channel_input.output_reference,
    transaction,
  )
}
