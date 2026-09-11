use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs
use aiken/interval
use cardano/address.{from_verification_key}
use cardano/assets
use cardano/script_context.{ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, Spend,
  Transaction,
}
use host_state_stt
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/transfer_module_datum.{TransferModuleDatum}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/client_datum.{
  ClientDatum, ClientDatumState,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/client/ics_007_tendermint_client/types/verify_proof_redeemer.{
  VerifyMembership, VerifyProofRedeemer,
}
use ibc/core/ics_003_connection_semantics/connection_datum.{ConnectionDatum}
use ibc/core/ics_004/channel_datum.{ChannelDatum, ChannelDatumState}
use ibc/core/ics_004/channel_redeemer.{
  ChanCloseConfirm, ChanCloseInit, ChanOpenConfirm, SpendChannelRedeemer,
}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order.{Unordered}
use ibc/core/ics_004/types/state.{ChannelState, Closed, Open}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnChanCloseConfirm, OnChanCloseInit,
}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, LeafOp,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleProof,
  MerkleRoot} as merkle
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, empty_ibc_state_root,
}
use ibc/core/ics_025_handler_interface/host_state_redeemer.{
  HostStateRedeemer, UpdateChannel,
}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/test_utils
use ibc/utils/validator_utils
use spending_channel
use spending_channel/chan_close_confirm
use spending_channel/spending_channel_fixture.{setup}
use spending_transfer_module
use verifying_proof

const shard_policy_id = "mock transfer shard policy id"

const locked_policy_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type Fixture {
  tx: Transaction,
  input_datum: ChannelDatum,
  channel_redeemer: SpendChannelRedeemer,
  module_redeemer: IBCModuleRedeemer,
  host_redeemer: HostStateRedeemer,
  verify_redeemer: VerifyProofRedeemer,
}

// A real two-level SDK membership proof, checked against the standard IAVL and
// Tendermint proof specs by verifying_proof in the composed tests below.
fn membership_proof(
  key: ByteArray,
  value: ByteArray,
) -> (MerkleProof, MerkleRoot) {
  let leaf =
    LeafOp {
      hash: 1,
      prehash_key: 0,
      prehash_value: 1,
      length: 1,
      prefix: #"000202",
    }
  let channel_step =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof { key, value, leaf, path: [] },
      },
    }
  let store_step =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          key: "ibc",
          value: proof.calculate(channel_step),
          leaf: LeafOp { ..leaf, prefix: #"00" },
          path: [],
        },
      },
    }
  (
    MerkleProof { proofs: [channel_step, store_step] },
    MerkleRoot { hash: proof.calculate(store_step) },
  )
}

fn fixture(counterparty_state: ChannelState) -> Fixture {
  let mock = setup()
  let proof_height = Height { revision_number: 1, revision_height: 13 }
  let channel =
    Channel {
      state: Open,
      ordering: Unordered,
      counterparty: ChannelCounterparty {
        port_id: "transfer",
        channel_id: "channel-7",
      },
      connection_hops: [mock.connection_id],
      version: "ics20-1",
    }
  let input_datum =
    ChannelDatum {
      state: ChannelDatumState {
        channel,
        next_sequence_send: 1,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
        minimum_receive_proof_height: height_mod.zero_height(),
        maximum_receive_proof_height: height_mod.zero_height(),
      },
      port_id: mock.port_id,
      token: mock.channel_token,
    }
  let channel_input =
    Input {
      ..test_utils.build_channel_input(input_datum, mock.channel_token),
      // Keep consumed and referenced out-refs disjoint.
      output_reference: OutputReference {
        ..mock.module_input.output_reference,
        output_index: 4,
      },
    }
  let output_datum =
    ChannelDatum {
      ..input_datum,
      state: ChannelDatumState {
        ..input_datum.state,
        channel: Channel { ..channel, state: Closed },
      },
    }
  let channel_output =
    test_utils.build_channel_output(output_datum, mock.channel_token)
  let module_output =
    Output {
      ..mock.module_input.output,
      value: mock.module_input.output.value
        |> assets.add("", "", 5_000_000),
      datum: InlineDatum(
        TransferModuleDatum {
          escrow_shard_registry_root: ibc_state_commitment.empty_hash,
        },
      ),
    }
  let module_input = Input { ..mock.module_input, output: module_output }

  let siblings =
    list.repeat(
      ibc_state_commitment.empty_hash,
      ibc_state_commitment.merkle_depth_bits,
    )
  let channel_key = channel_keys.channel_path(mock.port_id, mock.channel_id)
  let old_root =
    ibc_state_commitment.apply_update(
      empty_ibc_state_root,
      channel_key,
      "",
      cbor.serialise(channel),
      siblings,
    )
  let new_root =
    ibc_state_commitment.apply_update(
      old_root,
      channel_key,
      cbor.serialise(channel),
      cbor.serialise(output_datum.state.channel),
      siblings,
    )
  expect original_host: HostStateDatum =
    validator_utils.get_inline_datum(mock.host_state_input.output)
  let old_host =
    HostStateDatum {
      ..original_host,
      state: HostState { ..original_host.state, ibc_state_root: old_root },
    }
  let new_host =
    HostStateDatum {
      ..old_host,
      state: HostState {
        ..old_host.state,
        ibc_state_root: new_root,
        version: old_host.state.version + 1,
      },
    }
  let host_input =
    Input {
      ..mock.host_state_input,
      output: Output {
        ..mock.host_state_input.output,
        datum: InlineDatum(old_host),
      },
    }
  let host_output = Output { ..host_input.output, datum: InlineDatum(new_host) }

  expect connection_datum: ConnectionDatum =
    validator_utils.get_inline_datum(mock.connection_input.output)
  let counterparty_channel =
    Channel {
      ..channel,
      state: counterparty_state,
      counterparty: ChannelCounterparty {
        port_id: mock.port_id,
        channel_id: mock.channel_id,
      },
      connection_hops: [connection_datum.state.counterparty.connection_id],
    }
  let channel_bz =
    channel_pb.marshal_for_channel(
      channel.convert_to_channel_proto(counterparty_channel),
    ).2nd
  let proof_key =
    channel_keys.channel_path(
      channel.counterparty.port_id,
      channel.counterparty.channel_id,
    )
  let (proof_init, proof_root) = membership_proof(proof_key, channel_bz)
  expect original_client: ClientDatum =
    validator_utils.get_inline_datum(mock.client_input.output)
  expect Some(original_consensus) =
    pairs.get_first(original_client.state.consensus_states, proof_height)
  let consensus = ConsensusState { ..original_consensus, root: proof_root }
  let client_datum =
    ClientDatum {
      ..original_client,
      state: ClientDatumState {
        ..original_client.state,
        consensus_states: [Pair(proof_height, consensus)],
      },
    }
  let client_input =
    Input {
      ..mock.client_input,
      output: Output {
        ..mock.client_input.output,
        datum: InlineDatum(client_datum),
      },
    }

  let channel_redeemer = ChanCloseConfirm { proof_init, proof_height }
  let module_redeemer =
    Callback(OnChanCloseConfirm { channel_id: mock.channel_id })
  let host_redeemer = UpdateChannel { channel_siblings: siblings }
  let verify_redeemer =
    VerifyMembership {
      cs: client_datum.state.client_state,
      cons_state: consensus,
      height: proof_height,
      processed_time: 0,
      processed_height: 0,
      delay_time_period: 0,
      delay_block_period: 0,
      proof: proof_init,
      path: merkle.apply_prefix(
        connection_datum.state.counterparty.prefix,
        merkle.new_merkle_path([proof_key]),
      ),
      value: channel_bz,
    }
  let channel_data: Redeemer = channel_redeemer
  let module_data: Redeemer = module_redeemer
  let host_data: Redeemer = host_redeemer
  let verify_data: Redeemer = verify_redeemer
  let token_data: Redeemer = mock.channel_token
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [channel_input, module_input, host_input],
      reference_inputs: [mock.connection_input, client_input],
      outputs: [channel_output, module_output, host_output],
      redeemers: [
        Pair(Spend(channel_input.output_reference), channel_data),
        Pair(Spend(module_input.output_reference), module_data),
        Pair(Spend(host_input.output_reference), host_data),
        Pair(Mint(mock.chan_close_confirm_policy_id), token_data),
        Pair(Mint(mock.verify_proof_policy_id), verify_data),
      ],
      validity_range: interval.between(1_577_923_295_000, 1_577_923_296_000),
      mint: assets.from_asset(mock.chan_close_confirm_policy_id, "", 1)
        |> assets.add(mock.verify_proof_policy_id, "", 1),
    }
  Fixture {
    tx,
    input_datum,
    channel_redeemer,
    module_redeemer,
    host_redeemer,
    verify_redeemer,
  }
}

fn check_module(f: Fixture) -> Bool {
  let mock = setup()
  let port_token =
    AuthToken {
      policy_id: mock.port_minting_policy_id,
      name: port_keys.port_token_name(mock.port_id),
    }
  spending_transfer_module.spend_transfer_module.spend(
    port_token,
    mock.module_token,
    mock.port_id,
    shard_policy_id,
    mock.channel_minting_policy_id,
    "mock voucher policy id",
    mock.host_state_nft_policy_id,
    None,
    f.module_redeemer,
    mock.module_input.output_reference,
    f.tx,
  )
}

fn check_marker(f: Fixture) -> Bool {
  let mock = setup()
  chan_close_confirm.chan_close_confirm.mint(
    mock.client_minting_policy_id,
    mock.connection_minting_policy_id,
    mock.port_minting_policy_id,
    mock.verify_proof_policy_id,
    mock.host_state_nft_policy_id,
    mock.channel_token,
    mock.chan_close_confirm_policy_id,
    f.tx,
  )
}

fn check_proof(f: Fixture) -> Bool {
  verifying_proof.verify_proof.mint(
    f.verify_redeemer,
    setup().verify_proof_policy_id,
    f.tx,
  )
}

fn with_channel_redeemer(f: Fixture, redeemer: SpendChannelRedeemer) -> Fixture {
  expect [channel_input, ..] = f.tx.inputs
  let data: Redeemer = redeemer
  Fixture {
    ..f,
    channel_redeemer: redeemer,
    tx: Transaction {
      ..f.tx,
      redeemers: pairs.map(
        f.tx.redeemers,
        fn(purpose, old) {
          if purpose == Spend(channel_input.output_reference) {
            data
          } else {
            old
          }
        },
      ),
    },
  }
}

fn with_channel_output(f: Fixture, datum: ChannelDatum) -> Fixture {
  expect [channel_output, ..rest] = f.tx.outputs
  Fixture {
    ..f,
    tx: Transaction {
      ..f.tx,
      outputs: [Output { ..channel_output, datum: InlineDatum(datum) }, ..rest],
    },
  }
}

fn with_module_output(f: Fixture, output: Output) -> Fixture {
  expect [channel_output, _, host_output] = f.tx.outputs
  Fixture {
    ..f,
    tx: Transaction { ..f.tx, outputs: [channel_output, output, host_output] },
  }
}

fn module_output(f: Fixture) -> Output {
  expect [_, output, _] = f.tx.outputs
  output
}

test transfer_close_confirm_composed_transaction_succeeds() {
  let f = fixture(Closed)
  let mock = setup()
  expect [channel_input, _, host_input] = f.tx.inputs
  and {
    check_module(f)?,
    check_marker(f)?,
    check_proof(f)?,
    spending_channel.spend_channel.spend(
      mock.chan_open_ack_policy_id,
      mock.chan_open_confirm_policy_id,
      mock.chan_close_init_policy_id,
      mock.chan_close_confirm_policy_id,
      mock.recv_packet_policy_id,
      mock.send_packet_policy_id,
      mock.timeout_packet_policy_id,
      mock.acknowledge_packet_policy_id,
      mock.prune_packet_history_policy_id,
      mock.host_state_nft_policy_id,
      Some(f.input_datum),
      f.channel_redeemer,
      channel_input.output_reference,
      f.tx,
    )?,
    host_state_stt.host_state_stt.spend(
      mock.host_state_nft_policy_id,
      "unused client script",
      "unused connection script",
      "mock spend channel script hash",
      mock.client_minting_policy_id,
      mock.connection_minting_policy_id,
      mock.channel_minting_policy_id,
      None,
      f.host_redeemer,
      host_input.output_reference,
      f.tx,
    )?,
  }
}

test transfer_close_confirm_rejects_proven_open_counterparty() {
  let f = fixture(Open)
  and {
    check_module(f),
    check_proof(f),
    !check_marker(f),
  }
}

test transfer_close_confirm_rejects_invalid_proof() fail {
  let f = fixture(Closed)
  expect VerifyMembership {
    cs,
    cons_state,
    height,
    processed_time,
    processed_height,
    delay_time_period,
    delay_block_period,
    path,
    value,
    ..
  } = f.verify_redeemer
  let invalid_proof = MerkleProof { proofs: [] }
  let verify_redeemer =
    VerifyMembership {
      cs,
      cons_state,
      height,
      processed_time,
      processed_height,
      delay_time_period,
      delay_block_period,
      path,
      value,
      proof: invalid_proof,
    }
  let verify_data: Redeemer = verify_redeemer
  let invalid =
    with_channel_redeemer(
      f,
      ChanCloseConfirm { proof_init: invalid_proof, proof_height: height },
    )
  let tx =
    Transaction {
      ..invalid.tx,
      redeemers: pairs.map(
        invalid.tx.redeemers,
        fn(purpose, old) {
          if purpose == Mint(setup().verify_proof_policy_id) {
            verify_data
          } else {
            old
          }
        },
      ),
    }
  let invalid = Fixture { ..invalid, tx, verify_redeemer }
  expect check_module(invalid)
  expect check_marker(invalid)
  expect check_proof(invalid)
  True
}

test transfer_close_confirm_rejects_missing_channel() fail {
  let f = fixture(Closed)
  expect [_, ..inputs] = f.tx.inputs
  check_module(Fixture { ..f, tx: Transaction { ..f.tx, inputs } })
}

test transfer_close_confirm_rejects_wrong_channel_id() fail {
  let f = fixture(Closed)
  check_module(
    Fixture {
      ..f,
      module_redeemer: Callback(OnChanCloseConfirm { channel_id: "channel-99" }),
    },
  )
}

test transfer_close_confirm_rejects_wrong_channel_policy() fail {
  let f = fixture(Closed)
  expect [channel_input, ..rest] = f.tx.inputs
  let fake_input =
    Input {
      ..channel_input,
      output: Output {
        ..channel_input.output,
        value: assets.from_asset(
          "fake channel policy",
          setup().channel_token.name,
          1,
        ),
      },
    }
  check_module(
    Fixture { ..f, tx: Transaction { ..f.tx, inputs: [fake_input, ..rest] } },
  )
}

test transfer_close_confirm_rejects_missing_channel_redeemer() fail {
  let f = fixture(Closed)
  expect [channel_input, ..] = f.tx.inputs
  check_module(
    Fixture {
      ..f,
      tx: Transaction {
        ..f.tx,
        redeemers: pairs.delete_all(
          f.tx.redeemers,
          Spend(channel_input.output_reference),
        ),
      },
    },
  )
}

test transfer_close_confirm_rejects_close_init_redeemer() fail {
  check_module(with_channel_redeemer(fixture(Closed), ChanCloseInit))
}

test transfer_close_confirm_rejects_open_confirm_redeemer() fail {
  let f = fixture(Closed)
  expect ChanCloseConfirm { proof_init, proof_height } = f.channel_redeemer
  check_module(
    with_channel_redeemer(
      f,
      ChanOpenConfirm { proof_ack: proof_init, proof_height },
    ),
  )
}

test transfer_close_confirm_rejects_wrong_port() fail {
  let f = fixture(Closed)
  expect [channel_input, ..rest] = f.tx.inputs
  let wrong_datum = ChannelDatum { ..f.input_datum, port_id: "port-99" }
  let input =
    Input {
      ..channel_input,
      output: Output { ..channel_input.output, datum: InlineDatum(wrong_datum) },
    }
  let wrong_port =
    Fixture { ..f, tx: Transaction { ..f.tx, inputs: [input, ..rest] } }
  expect check_module(wrong_port)
  check_marker(wrong_port)
}

test transfer_close_confirm_rejects_channel_left_open() {
  let f = fixture(Closed)
  let invalid = with_channel_output(f, f.input_datum)
  and {
    check_module(invalid),
    !check_marker(invalid),
  }
}

test transfer_close_confirm_rejects_another_ports_channel() fail {
  let f = fixture(Closed)
  expect [channel_input, ..rest] = f.tx.inputs
  let wrong_input = ChannelDatum { ..f.input_datum, port_id: "port-99" }
  let input =
    Input {
      ..channel_input,
      output: Output { ..channel_input.output, datum: InlineDatum(wrong_input) },
    }
  expect [output, ..] = f.tx.outputs
  expect output_datum: ChannelDatum = validator_utils.get_inline_datum(output)
  let wrong_port =
    with_channel_output(f, ChannelDatum { ..output_datum, port_id: "port-99" })
  check_module(
    Fixture {
      ..wrong_port,
      tx: Transaction { ..wrong_port.tx, inputs: [input, ..rest] },
    },
  )
}

test transfer_close_confirm_rejects_packet_state_changes() {
  let f = fixture(Closed)
  expect [output, ..] = f.tx.outputs
  expect datum: ChannelDatum = validator_utils.get_inline_datum(output)
  let invalid =
    with_channel_output(
      f,
      ChannelDatum {
        ..datum,
        state: ChannelDatumState { ..datum.state, next_sequence_send: 2 },
      },
    )
  and {
    check_module(invalid),
    !check_marker(invalid),
  }
}

test transfer_close_confirm_rejects_missing_channel_continuation() fail {
  let f = fixture(Closed)
  expect [_, ..outputs] = f.tx.outputs
  let invalid = Fixture { ..f, tx: Transaction { ..f.tx, outputs } }
  expect check_module(invalid)
  check_marker(invalid)
}

test transfer_close_confirm_rejects_module_datum_change() fail {
  let f = fixture(Closed)
  check_module(
    with_module_output(
      f,
      Output {
        ..module_output(f),
        datum: InlineDatum(
          TransferModuleDatum { escrow_shard_registry_root: "different root" },
        ),
      },
    ),
  )
}

test transfer_close_confirm_rejects_module_relocation() fail {
  let f = fixture(Closed)
  check_module(
    with_module_output(
      f,
      Output { ..module_output(f), address: from_verification_key("attacker") },
    ),
  )
}

test transfer_close_confirm_rejects_lovelace_withdrawal() {
  let f = fixture(Closed)
  let output = module_output(f)
  !check_module(
    with_module_output(
      f,
      Output { ..output, value: assets.add(output.value, "", "", -1) },
    ),
  )
}

test transfer_close_confirm_rejects_non_ada_value_change() {
  let f = fixture(Closed)
  let output = module_output(f)
  !check_module(
    with_module_output(
      f,
      Output {
        ..output,
        value: assets.add(output.value, locked_policy_id, "locked", 1),
      },
    ),
  )
}

test transfer_close_confirm_rejects_capability_token_withdrawal() fail {
  let f = fixture(Closed)
  let output = module_output(f)
  let token = setup().module_token
  check_module(
    with_module_output(
      f,
      Output {
        ..output,
        value: assets.add(output.value, token.policy_id, token.name, -1),
      },
    ),
  )
}

test transfer_close_confirm_allows_minimum_ada_top_up() {
  let f = fixture(Closed)
  let output = module_output(f)
  check_module(
    with_module_output(
      f,
      Output { ..output, value: assets.add(output.value, "", "", 1_000_000) },
    ),
  )
}

test transfer_close_confirm_rejects_escrow_shard_callback() fail {
  let f = fixture(Closed)
  expect [channel_input, module_input, host_input] = f.tx.inputs
  let datum =
    TransferEscrowDatum {
      channel_id: setup().channel_id,
      denom: "6c6f76656c616365",
    }
  let shard =
    Output {
      ..module_output(f),
      value: assets.from_asset(
        shard_policy_id,
        transfer_escrow_shard.shard_token_name(datum.channel_id, datum.denom),
        1,
      )
        |> assets.add("", "", 5_000_000),
      datum: InlineDatum(datum),
    }
  let with_shard_output = with_module_output(f, shard)
  check_module(
    Fixture {
      ..with_shard_output,
      tx: Transaction {
        ..with_shard_output.tx,
        inputs: [
          channel_input,
          Input { ..module_input, output: shard },
          host_input,
        ],
      },
    },
  )
}

test transfer_close_init_remains_rejected_with_valid_channel_context() {
  let f = with_channel_redeemer(fixture(Closed), ChanCloseInit)
  !check_module(
    Fixture {
      ..f,
      module_redeemer: Callback(
        OnChanCloseInit { channel_id: setup().channel_id },
      ),
    },
  )
}

test transfer_close_confirm_rejects_missing_marker_mint() fail {
  let f = fixture(Closed)
  check_marker(
    Fixture {
      ..f,
      tx: Transaction {
        ..f.tx,
        mint: assets.from_asset(setup().verify_proof_policy_id, "", 1),
      },
    },
  )
}

test transfer_close_confirm_rejects_extra_marker_asset() fail {
  let f = fixture(Closed)
  check_marker(
    Fixture {
      ..f,
      tx: Transaction {
        ..f.tx,
        mint: assets.add(
          f.tx.mint,
          setup().chan_close_confirm_policy_id,
          "extra",
          1,
        ),
      },
    },
  )
}

test transfer_close_confirm_rejects_spending_purpose() fail {
  let mock = setup()
  chan_close_confirm.chan_close_confirm.else(
    mock.client_minting_policy_id,
    mock.connection_minting_policy_id,
    mock.port_minting_policy_id,
    mock.verify_proof_policy_id,
    mock.host_state_nft_policy_id,
    ScriptContext {
      transaction: transaction.placeholder,
      redeemer: mock.channel_token,
      info: Spending { output: mock.module_input.output_reference, datum: None },
    },
  )
}
