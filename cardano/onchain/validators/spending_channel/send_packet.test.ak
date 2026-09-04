use aiken/collection/list
use cardano/address.{from_script}
use cardano/assets.{ada_asset_name, ada_policy_id, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, Output, OutputReference, Redeemer, ScriptPurpose,
  Spend, Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{CreateEscrowShard}
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/height.{Height} as height_mod
use ibc/core/ics_004/channel_datum.{ChannelDatum,
  ChannelDatumState} as channel_datum_mod
use ibc/core/ics_004/channel_redeemer.{SendPacket}
use ibc/core/ics_004/types/channel.{Channel}
use ibc/core/ics_004/types/counterparty.{ChannelCounterparty}
use ibc/core/ics_004/types/order as chan_order_mod
use ibc/core/ics_004/types/packet.{Packet} as packet_mod
use ibc/core/ics_004/types/state as chan_state_mod
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, ModuleDataV1, OnSendPacket, Operator,
  OtherModuleOperator,
}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/host_state_redeemer.{HandlePacket}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/test_utils
use minting_transfer_escrow_shard
use spending_channel
use spending_channel/send_packet
use spending_channel/spending_channel_fixture.{MockData, setup}
use spending_transfer_module

type CallbackMutation {
  ValidCallback
  MissingModule
  UntypedCallback
  WrongChannel
  WrongPacketData
  WrongPacketCommitment
  WrongTypedPacketData
  ReferenceBoundShard
  WrongModuleCredential
}

fn repeat_bytearray(value: ByteArray, count: Int) -> List<ByteArray> {
  if count <= 0 {
    []
  } else {
    [value, ..repeat_bytearray(value, count - 1)]
  }
}

fn full_empty_siblings() -> List<ByteArray> {
  repeat_bytearray(
    ibc_state_commitment.empty_hash,
    ibc_state_commitment.merkle_depth_bits,
  )
}

fn check_send_packet_with_data(
  mutation: CallbackMutation,
  packet_data: ByteArray,
) {
  let mock_data = setup()

  let transfer_data =
    FungibleTokenPacketData {
      denom: "6c6f76656c616365",
      amount: "1000",
      sender: "525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22",
      receiver: "receiver",
      memo: "",
    }
  let packet =
    Packet {
      sequence: 1,
      source_port: "port-1",
      source_channel: "channel-0",
      destination_port: "port-1",
      destination_channel: "channel-0",
      data: packet_data,
      timeout_height: Height { revision_number: 0, revision_height: 0 },
      timeout_timestamp: 1735689600000000000,
    }

  //========================arrange inputs=======================
  let input_channel =
    Channel {
      state: chan_state_mod.Open,
      ordering: chan_order_mod.Unordered,
      counterparty: ChannelCounterparty {
        port_id: "port-1",
        channel_id: "channel-0",
      },
      connection_hops: [mock_data.connection_id],
      version: "mock-version",
    }

  let input_channel_datum =
    ChannelDatum {
      state: ChannelDatumState {
        maximum_receive_proof_height: height_mod.zero_height(),
        minimum_receive_proof_height: height_mod.zero_height(),
        channel: input_channel,
        next_sequence_send: packet.sequence,
        next_sequence_recv: 1,
        next_sequence_ack: 1,
        packet_commitment: [],
        packet_receipt: [],
        packet_acknowledgement: [],
      },
      port_id: mock_data.port_id,
      token: mock_data.channel_token,
    }

  let channel_input =
    test_utils.build_channel_input(input_channel_datum, mock_data.channel_token)

  let port_token_name = port_keys.port_token_name(mock_data.port_id)
  let port_token =
    AuthToken {
      policy_id: mock_data.port_minting_policy_id,
      name: port_token_name,
    }
  let module_token = mock_data.module_token
  let registered_module_input = mock_data.module_input
  let registry_siblings = full_empty_siblings()
  let updated_registry_root =
    ibc_state_commitment.apply_update(
      empty_escrow_shard_registry_root,
      transfer_escrow_shard.shard_registry_key("channel-0", transfer_data.denom),
      "",
      transfer_escrow_shard.registered_shard_value,
      registry_siblings,
    )
  let module_output =
    Output {
      ..registered_module_input.output,
      datum: InlineDatum(
        TransferModuleDatum {
          escrow_shard_registry_root: updated_registry_root,
        },
      ),
    }
  let host_state_input = mock_data.host_state_input
  let module_spend_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        output_index: 0,
      },
      output: Output {
        address: when mutation is {
          WrongModuleCredential -> from_script("different module script hash")
          _ -> registered_module_input.output.address
        },
        value: from_asset("mock shard policy", "mock shard", 1),
        datum: InlineDatum(Void),
        reference_script: None,
      },
    }

  let inputs =
    when mutation is {
      MissingModule -> [channel_input, host_state_input]
      ReferenceBoundShard ->
        [module_spend_input, channel_input, host_state_input]
      WrongModuleCredential ->
        [module_spend_input, channel_input, host_state_input]
      _ -> [registered_module_input, channel_input, host_state_input]
    }

  //========================arrange reference_inputs=======================
  let reference_inputs =
    when mutation is {
      ReferenceBoundShard ->
        [
          mock_data.connection_input,
          mock_data.client_input,
          registered_module_input,
        ]
      WrongModuleCredential ->
        [
          mock_data.connection_input,
          mock_data.client_input,
          registered_module_input,
        ]
      _ -> [mock_data.connection_input, mock_data.client_input]
    }

  //========================arrange outputs=======================
  let commitment = packet_mod.commit_packet(packet)

  let output_channel_datum =
    ChannelDatum {
      ..input_channel_datum,
      state: ChannelDatumState {
        ..input_channel_datum.state,
        next_sequence_send: input_channel_datum.state.next_sequence_send + 1,
        packet_commitment: [
          Pair(packet.sequence, commitment),
          ..input_channel_datum.state.packet_commitment
        ],
      },
    }

  let channel_output =
    test_utils.build_channel_output(
      output_channel_datum,
      mock_data.channel_token,
    )

  let transfer_escrow_shard_policy_id = "mock transfer escrow shard policy"
  let shard_token_name =
    transfer_escrow_shard.shard_token_name("channel-0", transfer_data.denom)
  let escrow_output =
    Output {
      address: registered_module_input.output.address,
      value: from_asset(ada_policy_id, ada_asset_name, 1000)
        |> add(transfer_escrow_shard_policy_id, shard_token_name, 1),
      datum: InlineDatum(
        TransferEscrowDatum {
          channel_id: "channel-0",
          denom: transfer_data.denom,
        },
      ),
      reference_script: None,
    }
  let outputs =
    when mutation is {
      MissingModule -> [channel_output, host_state_input.output]
      ReferenceBoundShard -> [channel_output, host_state_input.output]
      WrongModuleCredential -> [channel_output, host_state_input.output]
      _ ->
        [channel_output, host_state_input.output, module_output, escrow_output]
    }

  //========================arrange validity_range=======================
  let validity_range = mock_data.validity_range

  //========================arrange redeemers=======================
  let spend_channel_redeemer: Redeemer = SendPacket { packet }

  let module_redeemer: Redeemer =
    when mutation is {
      UntypedCallback -> Operator(OtherModuleOperator)
      WrongChannel ->
        Callback(
          OnSendPacket {
            channel_id: "channel-999",
            packet_data,
            packet_commitment: commitment,
            data: ModuleDataV1(transfer_data),
          },
        )
      WrongPacketData ->
        Callback(
          OnSendPacket {
            channel_id: "channel-0",
            packet_data: "different packet data",
            packet_commitment: commitment,
            data: ModuleDataV1(transfer_data),
          },
        )
      WrongPacketCommitment ->
        Callback(
          OnSendPacket {
            channel_id: "channel-0",
            packet_data,
            packet_commitment: "different commitment",
            data: ModuleDataV1(transfer_data),
          },
        )
      WrongTypedPacketData ->
        Callback(
          OnSendPacket {
            channel_id: "channel-0",
            packet_data,
            packet_commitment: commitment,
            data: ModuleDataV1(
              FungibleTokenPacketData { ..transfer_data, amount: "999" },
            ),
          },
        )
      _ ->
        Callback(
          OnSendPacket {
            channel_id: "channel-0",
            packet_data,
            packet_commitment: commitment,
            data: ModuleDataV1(transfer_data),
          },
        )
    }
  expect typed_module_redeemer: IBCModuleRedeemer = module_redeemer

  let send_packet_redeemer: Redeemer = mock_data.channel_token
  let host_state_redeemer: Redeemer =
    HandlePacket {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: [],
      packet_acknowledgement_siblings: [],
    }
  let shard_mint_redeemer =
    CreateEscrowShard {
      channel_id: "channel-0",
      denom: transfer_data.denom,
      data: transfer_data,
      registry_siblings,
    }
  let shard_mint_redeemer_data: Redeemer = shard_mint_redeemer

  let module_redeemers =
    when mutation is {
      MissingModule -> []
      ReferenceBoundShard ->
        [Pair(Spend(module_spend_input.output_reference), module_redeemer)]
      WrongModuleCredential ->
        [Pair(Spend(module_spend_input.output_reference), module_redeemer)]
      _ ->
        [Pair(Spend(registered_module_input.output_reference), module_redeemer)]
    }
  let shard_mint_redeemers =
    when mutation is {
      MissingModule -> []
      ReferenceBoundShard -> []
      WrongModuleCredential -> []
      _ ->
        [Pair(Mint(transfer_escrow_shard_policy_id), shard_mint_redeemer_data)]
    }
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(channel_input.output_reference), spend_channel_redeemer),
      Pair(Spend(host_state_input.output_reference), host_state_redeemer),
      Pair(Mint(mock_data.send_packet_policy_id), send_packet_redeemer),
      ..list.concat(module_redeemers, shard_mint_redeemers)
    ]

  let mint =
    when mutation is {
      MissingModule -> from_asset(mock_data.send_packet_policy_id, "", 1)
      ReferenceBoundShard -> from_asset(mock_data.send_packet_policy_id, "", 1)
      WrongModuleCredential ->
        from_asset(mock_data.send_packet_policy_id, "", 1)
      _ ->
        from_asset(mock_data.send_packet_policy_id, "", 1)
          |> add(transfer_escrow_shard_policy_id, shard_token_name, 1)
    }

  //==========================arrange context=========================
  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs,
      reference_inputs,
      outputs,
      redeemers,
      validity_range,
      mint,
    }

  let application_valid =
    when mutation is {
      MissingModule -> True
      ReferenceBoundShard -> True
      WrongModuleCredential -> True
      _ -> and {
          spending_transfer_module.spend_transfer_module.spend(
            port_token,
            module_token,
            mock_data.port_id,
            transfer_escrow_shard_policy_id,
            mock_data.channel_minting_policy_id,
            "mock voucher policy",
            mock_data.host_state_nft_policy_id,
            None,
            typed_module_redeemer,
            registered_module_input.output_reference,
            transaction,
          )?,
          minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint(
            port_token,
            shard_mint_redeemer,
            transfer_escrow_shard_policy_id,
            transaction,
          )?,
        }
    }

  and {
    send_packet.send_packet.spend(
      mock_data.client_minting_policy_id,
      mock_data.connection_minting_policy_id,
      mock_data.port_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      None,
      mock_data.channel_token,
      channel_input.output_reference,
      transaction,
    )?,
    send_packet.send_packet.mint(
      mock_data.client_minting_policy_id,
      mock_data.connection_minting_policy_id,
      mock_data.port_minting_policy_id,
      mock_data.host_state_nft_policy_id,
      mock_data.channel_token,
      mock_data.send_packet_policy_id,
      transaction,
    )?,
    spending_channel.spend_channel.spend(
      mock_data.chan_open_ack_policy_id,
      mock_data.chan_open_confirm_policy_id,
      mock_data.chan_close_init_policy_id,
      mock_data.chan_close_confirm_policy_id,
      mock_data.recv_packet_policy_id,
      mock_data.send_packet_policy_id,
      mock_data.timeout_packet_policy_id,
      mock_data.acknowledge_packet_policy_id,
      mock_data.prune_packet_history_policy_id,
      mock_data.host_state_nft_policy_id,
      Some(input_channel_datum),
      SendPacket { packet },
      channel_input.output_reference,
      transaction,
    )?,
    application_valid?,
  }
}

fn check_send_packet(mutation: CallbackMutation) {
  let transfer_data =
    FungibleTokenPacketData {
      denom: "6c6f76656c616365",
      amount: "1000",
      sender: "525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22",
      receiver: "receiver",
      memo: "",
    }
  check_send_packet_with_data(
    mutation,
    fungible_token_packet_data.get_bytes(transfer_data),
  )
}

test succeed_send_packet() {
  // Prebuilt canonical bytes keep this representative budget case from
  // double-charging the serializer that the validator itself exercises.
  check_send_packet_with_data(
    ValidCallback,
    #"7b22616d6f756e74223a2231303030222c2264656e6f6d223a2236633666373636353663363136333635222c227265636569766572223a227265636569766572222c2273656e646572223a223532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232227d",
  )
}

test send_packet_rejects_missing_registered_module() fail {
  check_send_packet(MissingModule)
}

test send_packet_rejects_untyped_module_callback() fail {
  check_send_packet(UntypedCallback)
}

test send_packet_rejects_wrong_callback_channel() fail {
  check_send_packet(WrongChannel)
}

test send_packet_rejects_wrong_callback_packet_data() fail {
  check_send_packet(WrongPacketData)
}

test send_packet_rejects_wrong_callback_commitment() fail {
  check_send_packet(WrongPacketCommitment)
}

test send_packet_rejects_mismatched_typed_application_data() fail {
  check_send_packet(WrongTypedPacketData)
}

test send_packet_accepts_shard_at_registered_module_credential() {
  check_send_packet(ReferenceBoundShard)
}

test send_packet_rejects_shard_at_wrong_module_credential() fail {
  check_send_packet(WrongModuleCredential)
}
