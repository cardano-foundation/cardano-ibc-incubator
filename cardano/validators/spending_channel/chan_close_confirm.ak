use aiken/interval
use aiken/list
use aiken/pairs
use aiken/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId, ValidityRange,
}
use aiken/transaction/credential
use aiken/transaction/value.{PolicyId}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState} as client_state_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client as client_status_mod
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_003_connection_semantics/types/state as conn_state_mod
use ibc/core/ics_003_connection_semantics/verify as verify_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{ChanCloseConfirm}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{Callback, OnChanOpenConfirm}
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/utils/test_utils
use ibc/utils/validator_utils

validator(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
) {
  fn chan_close_confirm(
    channel_token: AuthToken,
    context: ScriptContext,
  ) -> Bool {
    let Transaction {
      inputs,
      outputs,
      redeemers,
      reference_inputs,
      validity_range,
      ..
    } = context.transaction

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

    expect ChanCloseConfirm { proof_init, proof_height } = channel_redeemer

    trace @"chan_close_confirm: tx context extracted"

    let ChannelDatum { state: cur_channel_state, port_id, .. } = datum
    let ChannelDatumState { channel: cur_channel, .. } = cur_channel_state

    expect cur_channel.state != chan_state_mod.Closed
    trace @"chan_close_confirm: channel state is not Closed"

    expect Some(connection_datum) =
      validator_utils.validate_referred_connection(
        reference_inputs,
        datum.token.name,
        connection_minting_policy_id,
        connection_id,
      )
    trace @"chan_close_confirm: reference_inputs contain Connection utxo"

    expect connection_datum.state.state == conn_state_mod.Open
    trace @"chan_close_confirm: Connection is open"

    expect Some(client_datum) =
      validator_utils.validate_referred_client(
        reference_inputs,
        datum.token.name,
        client_minting_policy_id,
        connection_datum.state.client_id,
      )
    trace @"chan_close_confirm: reference_inputs contain Client utxo"

    expect
      client_state_mod.status(
        client_datum.state.client_state,
        tx_valid_to * 1_000_000,
        client_datum.state.consensus_states,
      ) == client_status_mod.Active
    trace @"chan_close_confirm: client status is active"

    expect channel_datum_mod.validate_chan_close_confirm(datum, updated_datum)
    trace @"chan_close_confirm: channel_datum is updated valid"

    expect
      validate_chan_close_confirm_proof(
        connection_datum.state,
        client_datum.state,
        channel_id,
        updated_datum,
        proof_init,
        proof_height,
        redeemers,
        verify_proof_policy_id,
      )
    trace @"chan_close_confirm: channel proof is valid"

    expect Some(ibc_module_redeemer) =
      validator_utils.extract_module_redeemer(
        inputs,
        redeemers,
        datum.token.name,
        port_minting_policy_id,
        port_id,
      )
    expect Callback(ibc_module_callback) = ibc_module_redeemer
    expect ibc_module_callback == OnChanOpenConfirm { channel_id }
    trace @"chan_close_confirm: ibc module callback is valid"

    True
  }
}

fn validate_chan_close_confirm_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_id: ByteArray,
  channel_datum: ChannelDatum,
  proof: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let counterparty_hops =
    [connection.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id }

  let expected_channel =
    Channel {
      state: chan_state_mod.Closed,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: channel_datum.state.channel.version,
    }

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

  let time_delay = connection.delay_period
  let block_delay = verify_mod.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          channel_keys.channel_path(
            channel_datum.state.channel.counterparty.port_id,
            channel_datum.state.channel.counterparty.channel_id,
          ),
        ],
      ),
    )

  expect Some(consensus_state) =
    pairs.get_first(client_datum_state.consensus_states, proof_height)

  let channel_bz =
    channel_pb.marshal_for_channel(
      Some(channel.convert_to_channel_proto(expected_channel)),
    )

  expect
    verify_proof_redeemer == VerifyMembership {
      cs: client_datum_state.client_state,
      cons_state: consensus_state,
      height: proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof,
      path: merkle_path,
      value: channel_bz,
    }

  True
}

//==========================================Test================================================
type MockData {
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  chan_close_confirm_policy_id: PolicyId,
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
          client_id: "07-tendermint-0",
          connection_id: "connection-0",
          prefix: MerklePrefix { key_prefix: "ibc" },
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
        transaction_id: TransactionId { hash: "tx_hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("mock connection script hash"),
        value: value.from_asset(
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
        transaction_id: TransactionId { hash: "tx_hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("mock client script hash"),
        value: value.from_asset(client_minting_policy_id, client_token_name, 1),
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
        transaction_id: TransactionId { hash: "fake module tx hash" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("fake module script hash"),
        value: value.from_asset(port_minting_policy_id, port_token_name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  MockData {
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    verify_proof_policy_id: "mock verify_proof_policy_id",
    chan_close_confirm_policy_id: "fake chan close init policy id",
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

  let inputs =
    [fake_data.module_input, channel_input]

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

  let reference_inputs =
    [fake_data.connection_input, client_input]

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

  let counterparty_hops =
    [connection.counterparty.connection_id]

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
      Pair(Mint(fake_data.chan_close_confirm_policy_id),
      chan_close_confirm_redeemer),
      Pair(Mint(fake_data.verify_proof_policy_id), verify_proof_redeemer),
    ]

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Spend(channel_input.output_reference),
      transaction: Transaction {
        ..transaction.placeholder(),
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  chan_close_confirm(
    fake_data.client_minting_policy_id,
    fake_data.connection_minting_policy_id,
    fake_data.port_minting_policy_id,
    fake_data.verify_proof_policy_id,
    fake_data.channel_token,
    context,
  )
}
