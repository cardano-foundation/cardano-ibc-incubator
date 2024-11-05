use aiken/collection/pairs
use aiken/crypto.{Blake2b_224, Hash, Script}
use aiken/interval
use cardano/address.{from_script}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction, TransactionId, ValidityRange,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/unchecked_rational
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_002_client_semantics/types/keys as client_keys_mod
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd} as connection_end_mod
use ibc/core/ics_003_connection_semantics/types/counterparty.{Counterparty} as conn_counterparty_mod
use ibc/core/ics_003_connection_semantics/types/keys as conn_keys_mod
use ibc/core/ics_003_connection_semantics/types/state as connection_state
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_003_connection_semantics/verify
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/channel_redeemer.{
  ChanOpenInit, ChanOpenTry, MintChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_004/types/order
use ibc/core/ics_004/types/order.{Ordered} as order_mod
use ibc/core/ics_004/types/state as channel_state
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnChanOpenInit, OnChanOpenTry,
}
use ibc/core/ics_005/types/keys as port_keys_mod
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, InnerSpec,
  LeafOp, ProofSpec,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof, MerkleRoot}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}
use ibc/core/ics_024_host_requirements/channel_keys as host_chan_keys
use ibc/core/ics_025_handler_interface/handler.{HandlerState}
use ibc/core/ics_025_handler_interface/handler_datum.{HandlerDatum}
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerChanOpenInit, HandlerChanOpenTry,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_channel(
  client_minting_policy_id: PolicyId,
  connection_minting_policy_id: PolicyId,
  port_minting_policy_id: PolicyId,
  verify_proof_policy_id: PolicyId,
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
) {
  mint(
    redeemer: MintChannelRedeemer,
    channel_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      mint,
      validity_range,
      redeemers,
      ..
    } = transaction

    expect [channel_output] =
      outputs
        |> transaction.find_script_outputs(spend_channel_script_hash)
    expect channel_output_datum: ChannelDatum =
      validator_utils.get_inline_datum(channel_output)
    trace @"mint_channel: found channel output"

    expect [connection_id] = channel_output_datum.state.channel.connection_hops
    trace @"mint_channel: extract connection_id"

    let tx_valid_to = validator_utils.get_tx_valid_to(validity_range)
    trace @"mint_channel: validator_utils.get_tx_valid_to"

    when redeemer is {
      ChanOpenInit { handler_token } -> {
        trace @"mint_channel: ChanOpenInit branch"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_token,
            HandlerChanOpenInit,
          )
        trace @"mint_channel: spent handler redeemer is valid"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            channel_output_datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_connection"

        expect [connection_version] = connection_datum.state.versions
        expect
          order.string(channel_output_datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"mint_channel: validate connection support channel ordering"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_channel: client status is active"

        expect Some(channel_token) =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> validator_utils.validate_mint(
                mint,
                channel_minting_policy_id,
                handler_token,
                channel_keys.channel_prefix,
                _,
              )
        trace @"mint_channel: validator_utils.validate_mint"

        expect auth.contain_auth_token(channel_output, channel_token)
        trace @"mint_channel: output contains connection token"

        expect
          channel_datum.validate_chan_open_init(
            channel_output_datum,
            channel_token,
          )
        trace @"mint_channel: channel datum is initialized valid"

        let channel_id =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> channel_keys.format_channel_identifier()

        expect Some(ibc_module_redeemer) =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            channel_token.name,
            port_minting_policy_id,
            channel_output_datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        expect ibc_module_callback == OnChanOpenInit { channel_id }
        trace @"mint_channel: ibc module callback is valid"

        True
      }

      ChanOpenTry {
        handler_token,
        counterparty_version,
        proof_init,
        proof_height,
      } -> {
        trace @"mint_channel: ChanOpenTry branch"

        expect Some(handler_datum) =
          validator_utils.validate_handler_redeemer(
            inputs,
            redeemers,
            handler_token,
            HandlerChanOpenTry,
          )
        trace @"mint_channel: spent handler redeemer is HandlerChanOpenTry"

        expect Some(connection_datum) =
          validator_utils.validate_referred_connection(
            reference_inputs,
            channel_output_datum.token.name,
            connection_minting_policy_id,
            connection_id,
          )
        trace @"mint_channel: reference_inputs contain Connection utxo"

        expect connection_datum.state.state == connection_state.Open
        trace @"mint_channel: Connection is open"

        expect [connection_version] = connection_datum.state.versions
        expect
          order.string(channel_output_datum.state.channel.ordering)
            |> version.verify_supported_feature(connection_version, _)
        trace @"mint_channel: connection support channel ordering"

        expect Some(client_datum) =
          validator_utils.validate_referred_client(
            reference_inputs,
            channel_output_datum.token.name,
            client_minting_policy_id,
            connection_datum.state.client_id,
          )
        trace @"mint_channel: validator_utils.validate_referred_client"

        expect
          client_state.status(
            client_datum.state.client_state,
            tx_valid_to * 1_000_000,
            client_datum.state.consensus_states,
          ) == Active
        trace @"mint_channel: client status is active"

        expect Some(channel_token) =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> validator_utils.validate_mint(
                mint,
                channel_minting_policy_id,
                handler_token,
                channel_keys.channel_prefix,
                _,
              )
        trace @"mint_channel: validator_utils.validate_mint"

        expect auth.contain_auth_token(channel_output, channel_token)
        trace @"mint_channel: output contains connection token"

        expect
          channel_datum.validate_chan_open_try(
            channel_output_datum,
            channel_token,
          )
        trace @"mint_channel: channel datum is initialized valid"

        expect
          validate_chan_open_try_proof(
            connection_datum.state,
            client_datum.state,
            channel_output_datum,
            counterparty_version,
            proof_init,
            proof_height,
            redeemers,
            verify_proof_policy_id,
          )
        trace @"mint_channel: channel init proof is valid"

        let channel_id =
          string_utils.int_to_string(handler_datum.state.next_channel_sequence)
            |> channel_keys.format_channel_identifier()

        expect Some(ibc_module_redeemer) =
          validator_utils.extract_module_redeemer(
            inputs,
            redeemers,
            channel_token.name,
            port_minting_policy_id,
            channel_output_datum.port_id,
          )
        expect Callback(ibc_module_callback) = ibc_module_redeemer
        expect ibc_module_callback == OnChanOpenTry { channel_id }
        trace @"mint_channel: ibc module callback is valid"

        True
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_chan_open_try_proof(
  connection: ConnectionEnd,
  client_datum_state: ClientDatumState,
  channel_datum: ChannelDatum,
  counterparty_version: ByteArray,
  proof: MerkleProof,
  proof_height: Height,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  verify_proof_policy_id: PolicyId,
) -> Bool {
  let counterparty_hops =
    [connection.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id: "" }

  let expected_channel =
    Channel {
      state: channel_state.Init,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: counterparty_version,
    }

  let time_delay = connection.delay_period
  let block_delay = verify.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          host_chan_keys.channel_path(
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

  expect Some(verify_proof_redeemer) =
    pairs.get_first(redeemers, Mint(verify_proof_policy_id))
  expect verify_proof_redeemer: VerifyProofRedeemer = verify_proof_redeemer

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
  spend_channel_script_hash: Hash<Blake2b_224, Script>,
  channel_minting_policy_id: PolicyId,
  channel_sequence: Int,
  handler_token: AuthToken,
  handler_input: Input,
  connection_id: ByteArray,
  connection_input: Input,
  client_input: Input,
  validity_range: ValidityRange,
  port_id: ByteArray,
  module_input: Input,
  proof_height: Height,
}

fn setup() -> MockData {
  //===========================Handler=============================

  let handler_token =
    AuthToken {
      name: "mock handler token name",
      policy_id: "mock handler token policy_id",
    }

  let channel_sequence = 324

  let handler_datum =
    HandlerDatum {
      state: HandlerState {
        next_client_sequence: 0,
        next_connection_sequence: 0,
        next_channel_sequence: channel_sequence,
        bound_port: [],
      },
      token: handler_token,
    }

  let spend_handler_output_reference =
    OutputReference {
      transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    }

  let handler_input =
    Input {
      output_reference: spend_handler_output_reference,
      output: Output {
        address: from_script("mock handler script hash"),
        value: from_asset(handler_token.policy_id, handler_token.name, 1),
        datum: InlineDatum(handler_datum),
        reference_script: None,
      },
    }

  //========================Connection============================
  let connection_datum =
    ConnectionDatum {
      state: ConnectionEnd {
        client_id: "ibc_client-10",
        versions: [
          Version {
            identifier: "1",
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        state: connection_state.Open,
        counterparty: Counterparty {
          client_id: "07-tendermint-0",
          connection_id: "connection-0",
          prefix: MerklePrefix { key_prefix: "ibc" },
        },
        delay_period: 0,
      },
      token: AuthToken { name: "", policy_id: "" },
    }

  let connection_id = "connection-134"

  let connection_sequence =
    conn_keys_mod.parse_connection_id_sequence(connection_id)

  let connection_token_name =
    auth.generate_token_name(
      handler_token,
      conn_keys_mod.connection_prefix,
      connection_sequence,
    )

  let connection_minting_policy_id = "mock connection_minting_policy_id"

  let connection_token =
    AuthToken {
      policy_id: connection_minting_policy_id,
      name: connection_token_name,
    }

  let connection_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock connection script hash"),
        value: from_asset(connection_token.policy_id, connection_token.name, 1),
        datum: InlineDatum(connection_datum),
        reference_script: None,
      },
    }

  //========================Client============================
  let cons_state =
    ConsensusState {
      timestamp: 1577923295000000000,
      next_validators_hash: #"be42d79cf15375efd54cf594c9f016db8c8b8dc4e91f35f11bba000ec7e9f439",
      root: MerkleRoot {
        hash: #"3d89dd39e1f1c7a0cec08f3ebf31fcb485f42068fcb79a8aeb3a9ca9f4e7091d",
      },
    }

  let trust_level = unchecked_rational.new(1, 3)

  let proof_specs =
    [
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 33,
          min_prefix_length: 4,
          max_prefix_length: 12,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
      ProofSpec {
        leaf_spec: LeafOp {
          hash: 1,
          prehash_value: 1,
          length: 1,
          prefix: #"00",
          prehash_key: 0,
        },
        inner_spec: InnerSpec {
          child_order: [0, 1],
          child_size: 32,
          min_prefix_length: 1,
          max_prefix_length: 1,
          hash: 1,
          empty_child: #"",
        },
        max_depth: 0,
        min_depth: 0,
        prehash_key_before_comparison: False,
      },
    ]

  let client_state =
    ClientState {
      chain_id: "testchain1-1",
      trust_level,
      trusting_period: 1209600000000000,
      unbonding_period: 1814400000000000,
      max_clock_drift: 10000000000,
      frozen_height: height_mod.zero_height(),
      latest_height: Height { revision_number: 1, revision_height: 13 },
      proof_specs,
    }

  let client_sequence =
    client_keys_mod.parse_client_id_sequence(connection_datum.state.client_id)

  let client_token_name =
    auth.generate_token_name(
      handler_token,
      client_keys_mod.client_prefix,
      client_sequence,
    )

  let client_minting_policy_id = "mock client_minting_policy_id"

  let client_token =
    AuthToken { policy_id: client_minting_policy_id, name: client_token_name }

  let proof_height = Height { revision_number: 1, revision_height: 13 }

  let client_datum =
    ClientDatum {
      state: ClientDatumState {
        client_state,
        consensus_states: [Pair(proof_height, cons_state)],
      },
      token: client_token,
    }

  let client_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("mock client script hash"),
        value: from_asset(client_token.policy_id, client_token.name, 1),
        datum: InlineDatum(client_datum),
        reference_script: None,
      },
    }

  //==========================ValidityRange===========================
  let valid_to =
    ( cons_state.timestamp + client_state.trusting_period ) / 1_000_000 - 1
  let validity_range = interval.before(valid_to)

  //==========================Module===========================
  let port_minting_policy_id = "mock port_minting_policy_id"

  let port_id = "port-1"
  let port_number = port_keys_mod.parse_port_id_number(port_id)
  let port_token_name =
    auth.generate_token_name(
      handler_token,
      port_keys_mod.port_prefix,
      port_number,
    )
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: TransactionId { hash: "mock module tx hash" },
        output_index: 0,
      },
      output: Output {
        address: from_script("mock module script hash"),
        value: from_asset(port_token.policy_id, port_token.name, 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  MockData {
    client_minting_policy_id,
    connection_minting_policy_id,
    port_minting_policy_id,
    verify_proof_policy_id: "mock verify_proof_policy_id",
    spend_channel_script_hash: "mock spend_channel_script_hash",
    channel_minting_policy_id: "mock channel_minting_policy_id",
    channel_sequence,
    handler_token,
    handler_input,
    connection_id,
    connection_input,
    client_input,
    validity_range,
    port_id,
    module_input,
    proof_height,
  }
}

test succeed_chan_open_init() {
  let mock_data = setup()

  //========================arrange inputs=======================
  let inputs =
    [mock_data.handler_input, mock_data.module_input]

  //========================arrange reference_inputs=======================
  let reference_inputs =
    [mock_data.connection_input, mock_data.client_input]

  //========================arrange outputs=======================
  let channel_token_name =
    string_utils.int_to_string(mock_data.channel_sequence)
      |> auth.generate_token_name(
          mock_data.handler_token,
          channel_keys.channel_prefix,
          _,
        )
  let channel_token =
    AuthToken {
      policy_id: mock_data.channel_minting_policy_id,
      name: channel_token_name,
    }

  let channel =
    Channel {
      state: channel_state.Init,
      ordering: Ordered,
      counterparty: ChannelCounterparty { port_id: "mock", channel_id: "" },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: channel_token,
    }

  let channel_output =
    Output {
      address: from_script(mock_data.spend_channel_script_hash),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(channel_datum),
      reference_script: None,
    }

  let outputs =
    [channel_output]

  //========================arrange mint=======================
  let mint =
    from_asset(channel_token.policy_id, channel_token.name, 1)
      |> value.to_minted_value()

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let handler_redeemer: Redeemer = HandlerChanOpenInit
  let mint_channel_redeemer: Redeemer =
    ChanOpenInit { handler_token: mock_data.handler_token }

  let channel_id =
    string_utils.int_to_string(mock_data.channel_sequence)
      |> channel_keys.format_channel_identifier()
  let module_redeemer: Redeemer = Callback(OnChanOpenInit { channel_id })

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.handler_input.output_reference), handler_redeemer),
      Pair(Mint(mock_data.channel_minting_policy_id), mint_channel_redeemer),
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
    ]

  let mint_channel_redeemer =
    ChanOpenInit { handler_token: mock_data.handler_token }

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Mint(mock_data.channel_minting_policy_id),
      transaction: Transaction {
        ..transaction.placeholder,
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        mint: mint,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  mint_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.spend_channel_script_hash,
    mint_channel_redeemer,
    context,
  )
}

test succeed_chan_open_try() {
  let mock_data = setup()

  //========================arrange inputs=======================
  let inputs =
    [mock_data.handler_input, mock_data.module_input]

  //========================arrange reference_inputs=======================
  let reference_inputs =
    [mock_data.connection_input, mock_data.client_input]

  //========================arrange outputs=======================
  let channel_token_name =
    string_utils.int_to_string(mock_data.channel_sequence)
      |> auth.generate_token_name(
          mock_data.handler_token,
          channel_keys.channel_prefix,
          _,
        )
  let channel_token =
    AuthToken {
      policy_id: mock_data.channel_minting_policy_id,
      name: channel_token_name,
    }

  let channel =
    Channel {
      state: channel_state.TryOpen,
      ordering: Ordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: channel_token,
    }

  let channel_output =
    Output {
      address: from_script(mock_data.spend_channel_script_hash),
      value: from_asset(channel_token.policy_id, channel_token.name, 1),
      datum: InlineDatum(channel_datum),
      reference_script: None,
    }

  let outputs =
    [channel_output]

  //========================arrange mint=======================
  let mint =
    from_asset(channel_token.policy_id, channel_token.name, 1)
      |> value.to_minted_value()

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let proof_init =
    MerkleProof {
      proofs: [
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              // key: #"6368616e6e656c456e64732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d30",
              key: #"6368616e6e656c456e64732f706f7274732f706f72742d312f6368616e6e656c732f6368616e6e656c2d30",
              value: #"080110021a080a06706f72742d31220c636f6e6e656374696f6e2d302a0c6d6f636b2d76657273696f6e",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"000218",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"02041820",
                  suffix: #"20072452876773f4e9b67456f4fd55fe48c9492aa788251556eab0975eb57ac2ca",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"04061820",
                  suffix: #"20bdf12b6f8b72754e6ca2a9c2645fd67b10ad95c6d79a9184302258e536a099e8",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"060e1820",
                  suffix: #"200846a49224ccac13ab6f251559f01f44154ecb8a794b06e916f05d786c667c52",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"08161820",
                  suffix: #"20743795f032d4499fa6462afc8be2844445937d12ffd3cc769d886836a45b7d9b",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"0c341820",
                  suffix: #"2075cb5e96a2dd7f63c4e0d53d3dbf4eee1ff8af0a0c9c5a4299c0c5e3d757a3fe",
                },
              ],
            },
          },
        },
        CommitmentProof {
          proof: CommitmentProof_Exist {
            exist: ExistenceProof {
              key: #"696263",
              value: #"5655858529b3c87b76dff17cb82a28df52ce2e9c184a33289dfb896c0c92f4f5",
              leaf: LeafOp {
                hash: 1,
                prehash_value: 1,
                length: 1,
                prefix: #"00",
                prehash_key: 0,
              },
              path: [
                InnerOp {
                  hash: 1,
                  prefix: #"0106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"102be2509e02c885c7493d6e0fa2792b08de6bcc7157707f39f39163f6e68efd",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01168116e3f4be1a4955b203aa979d29f890ccc0e6d2214f7125aa1f61e826b77b",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01fa5634ae3d864ecb98d30b5118c981ecc5bd08b7e9de40e8c0fb04f6b88ac806",
                  suffix: #"",
                },
                InnerOp {
                  hash: 1,
                  prefix: #"01",
                  suffix: #"8bff9e2cd715424c7dcd5e4b01f27da63f77dd32ce31f463fa6e71540c2a587d",
                },
              ],
            },
          },
        },
      ],
    }
  let counterparty_version = "mock-version"

  let mint_channel_redeemer: Redeemer =
    ChanOpenTry {
      handler_token: mock_data.handler_token,
      counterparty_version,
      proof_init,
      proof_height: mock_data.proof_height,
    }

  let handler_redeemer: Redeemer = HandlerChanOpenTry

  let channel_id =
    string_utils.int_to_string(mock_data.channel_sequence)
      |> channel_keys.format_channel_identifier()
  let module_redeemer: Redeemer = Callback(OnChanOpenTry { channel_id })

  expect client_datum: ClientDatum =
    validator_utils.get_inline_datum(mock_data.client_input.output)
  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock_data.connection_input.output)

  let connection = connection_datum.state

  let time_delay = connection.delay_period
  let block_delay = verify.get_block_delay(connection)

  let merkle_path =
    merkle.apply_prefix(
      connection.counterparty.prefix,
      merkle.new_merkle_path(
        [
          host_chan_keys.channel_path(
            channel_datum.state.channel.counterparty.port_id,
            channel_datum.state.channel.counterparty.channel_id,
          ),
        ],
      ),
    )

  let counterparty_hops =
    [connection.counterparty.connection_id]

  let expected_counterparty =
    ChannelCounterparty { port_id: channel_datum.port_id, channel_id: "" }

  expect Some(cons_state) =
    pairs.get_first(client_datum.state.consensus_states, mock_data.proof_height)

  let expected_channel =
    Channel {
      state: channel_state.Init,
      ordering: channel_datum.state.channel.ordering,
      counterparty: expected_counterparty,
      connection_hops: counterparty_hops,
      version: counterparty_version,
    }

  let channel_bz =
    channel_pb.marshal_for_channel(
      Some(channel.convert_to_channel_proto(expected_channel)),
    )

  let verify_proof_redeemer: Redeemer =
    VerifyMembership {
      cs: client_datum.state.client_state,
      cons_state,
      height: mock_data.proof_height,
      delay_time_period: time_delay,
      delay_block_period: block_delay,
      proof: proof_init,
      path: merkle_path,
      value: channel_bz,
    }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mock_data.handler_input.output_reference), handler_redeemer),
      Pair(Mint(mock_data.channel_minting_policy_id), mint_channel_redeemer),
      Pair(Spend(mock_data.module_input.output_reference), module_redeemer),
      Pair(Mint(mock_data.verify_proof_policy_id), verify_proof_redeemer),
    ]

  let mint_channel_redeemer =
    ChanOpenTry {
      handler_token: mock_data.handler_token,
      counterparty_version,
      proof_init,
      proof_height: mock_data.proof_height,
    }

  //==========================arrange context=========================
  let context =
    ScriptContext {
      purpose: Mint(mock_data.channel_minting_policy_id),
      transaction: Transaction {
        ..transaction.placeholder,
        inputs: inputs,
        reference_inputs: reference_inputs,
        outputs: outputs,
        mint: mint,
        redeemers: redeemers,
        validity_range: validity_range,
      },
    }

  mint_channel(
    mock_data.client_minting_policy_id,
    mock_data.connection_minting_policy_id,
    mock_data.port_minting_policy_id,
    mock_data.verify_proof_policy_id,
    mock_data.spend_channel_script_hash,
    mint_channel_redeemer,
    context,
  )
}
