use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction,
}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, RefundVoucher,
}
use ibc/apps/transfer/trace_registry.{
  Directory, InsertTrace, Shard, TraceRegistryDirectoryBucket,
  TraceRegistryDirectoryDatum, TraceRegistryEntry, TraceRegistryShardDatum,
  bucket_index_for_hash,
}
use ibc/apps/transfer/voucher_asset_name
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/types/acknowledgement
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket, OnRecvPacket, OnTimeoutPacket, Operator,
  TransferModuleData, TransferModuleOperator,
}
use ibc/utils/string as string_utils
use minting_voucher

type MockData {
  module_token: AuthToken,
  directory_auth_token: AuthToken,
  voucher_minting_policy_id: PolicyId,
  voucher_metadata_script_hash: crypto.ScriptHash,
  module_input: Input,
}

fn prepare_mock_data() -> MockData {
  let module_token =
    AuthToken { policy_id: "module token policy id", name: "module token name" }

  let module_input =
    Input {
      output_reference: OutputReference {
        transaction_id: #"30b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
        output_index: 0,
      },
      output: Output {
        address: from_script("spend module output address"),
        value: from_asset(module_token.policy_id, module_token.name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }

  MockData {
    module_token,
    directory_auth_token:
      AuthToken { policy_id: "trace shard policy id", name: "dir" },
    voucher_minting_policy_id: "mint voucher policy id",
    voucher_metadata_script_hash: "voucher metadata script hash",
    module_input,
  }
}

fn make_directory_input(
  directory_auth_token: AuthToken,
  bucket_index: Int,
  active_shard_name: ByteArray,
) -> Input {
  make_directory_input_with_archived(
    directory_auth_token,
    bucket_index,
    active_shard_name,
    [],
  )
}

fn make_directory_input_with_archived(
  directory_auth_token: AuthToken,
  bucket_index: Int,
  active_shard_name: ByteArray,
  archived_shard_names: List<ByteArray>,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"17b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 0,
    },
    output: Output {
      address: from_script("trace registry script hash"),
      value:
        from_asset(
          directory_auth_token.policy_id,
          directory_auth_token.name,
          1,
        ),
      datum:
        InlineDatum(
          Directory(
            TraceRegistryDirectoryDatum {
              buckets: [
                TraceRegistryDirectoryBucket {
                  bucket_index,
                  active_shard_name,
                  archived_shard_names,
                },
              ],
            },
          ),
        ),
      reference_script: None,
    },
  }
}

fn make_shard_reference_input(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Input {
  make_shard_reference_input_with_output_index(
    shard_policy_id,
    shard_name,
    bucket_index,
    voucher_hash,
    full_denom,
    1,
  )
}

fn make_shard_reference_input_with_output_index(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
  output_index: Int,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"27b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index,
    },
    output: Output {
      address: from_script("trace registry script hash"),
      value: from_asset(shard_policy_id, shard_name, 1),
      datum:
        InlineDatum(
          Shard(
            TraceRegistryShardDatum {
              bucket_index,
              entries: [TraceRegistryEntry { voucher_hash, full_denom }],
            },
          ),
        ),
      reference_script: None,
    },
  }
}

fn make_shard_spend_input(
  shard_policy_id: PolicyId,
  shard_name: ByteArray,
  bucket_index: Int,
) -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"37b9c5259b2a19052508957a025b5f150204027f1c6545fd886da6d281f6e926",
      output_index: 2,
    },
    output: Output {
      address: from_script("trace registry script hash"),
      value: from_asset(shard_policy_id, shard_name, 1),
      datum:
        InlineDatum(
          Shard(
            TraceRegistryShardDatum {
              bucket_index,
              entries: [],
            },
          ),
        ),
      reference_script: None,
    },
  }
}

fn make_metadata_output(
  voucher_metadata_script_hash: crypto.ScriptHash,
  voucher_policy_id: PolicyId,
  reference_token_name: ByteArray,
) -> Output {
  Output {
    address: from_script(voucher_metadata_script_hash),
    value: from_asset(voucher_policy_id, reference_token_name, 1),
    datum: InlineDatum(Void),
    reference_script: None,
  }
}

test test_mint_voucher() {
  let mock_data = prepare_mock_data()

  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"

  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
    }

  let transfer_amount = 100

  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: "",
    }

  let packet_data = TransferModuleData(ftpd)

  let spend_module_redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: packet_data,
      },
    )

  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(prefixed_denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_denom_hash)
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(voucher_denom_hash)
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0a"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let active_shard_input =
    make_shard_spend_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer
  let trace_registry_redeemer_in_data: Redeemer =
    InsertTrace { voucher_hash: voucher_denom_hash, full_denom: prefixed_denom }

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
      Pair(
        Spend(active_shard_input.output_reference),
        trace_registry_redeemer_in_data,
      ),
    ]

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
      |> assets.add(
        mock_data.voucher_minting_policy_id,
        reference_token_name,
        1,
      )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value:
        from_asset(
          mock_data.voucher_minting_policy_id,
          token_name,
          transfer_amount,
        ),
      datum: NoDatum,
      reference_script: None,
    }
  let metadata_output =
    make_metadata_output(
      mock_data.voucher_metadata_script_hash,
      mock_data.voucher_minting_policy_id,
      reference_token_name,
    )

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input, active_shard_input],
      reference_inputs: [directory_input],
      outputs: [voucher_output, metadata_output],
      redeemers,
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_mint_voucher_fails_without_trace_registry_witness() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "transfer"
  let packet_source_channel = "channel-1"
  let packet_dest_port = "port-99"
  let packet_dest_channel = "channel-99"

  let mint_voucher_redeemer =
    MintVoucher {
      packet_source_port,
      packet_source_channel,
      packet_dest_port,
      packet_dest_channel,
    }

  let transfer_amount = 100
  let receiver =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: "ibc/usdt",
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cosmos sender address",
      receiver,
      memo: "",
    }

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let token_name = voucher_asset_name.voucher_user_token_name(prefixed_denom)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer =
    Callback(
      OnRecvPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: TransferModuleData(ftpd),
      },
    )

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      outputs: [
        Output {
          address: from_verification_key(receiver_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_burn_voucher() {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"

  let mint_voucher_redeemer =
    BurnVoucher { packet_source_port, packet_source_channel }

  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let packet_data =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender: "cardano sender verification key",
      receiver: "cosmos address",
      memo: "",
    }

  let spend_module_redeemer =
    Operator(
      TransferModuleOperator(
        Transfer { channel_id: packet_source_channel, data: packet_data },
      ),
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let token_name = voucher_asset_name.voucher_user_token_name(packet_data.denom)

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
      ],
      mint:
        from_asset(
          mock_data.voucher_minting_policy_id,
          token_name,
          -transfer_amount,
        ),
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher() {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: "",
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_denom_hash)
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer =
    RefundVoucher { packet_source_port, packet_source_channel }
  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: packet_source_channel,
        data: TransferModuleData(ftpd),
      },
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      reference_inputs: [directory_input, shard_reference_input],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher_fails_when_hash_is_duplicated_in_archived_shard() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: "",
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_denom_hash)
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let archived_shard_name = "archived-shard-0f"
  let directory_input =
    make_directory_input_with_archived(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
      [archived_shard_name],
    )
  let active_shard_reference_input =
    make_shard_reference_input_with_output_index(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
      1,
    )
  let archived_duplicate_reference_input =
    make_shard_reference_input_with_output_index(
      mock_data.directory_auth_token.policy_id,
      archived_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
      2,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer =
    RefundVoucher { packet_source_port, packet_source_channel }
  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket {
        channel_id: packet_source_channel,
        data: TransferModuleData(ftpd),
      },
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      reference_inputs: [
        directory_input,
        active_shard_reference_input,
        archived_duplicate_reference_input,
      ],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

// ID-503-Not possible to refund voucher if transfer succeeds
test test_refund_voucher_fail() fail {
  let mock_data = prepare_mock_data()

  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let packet_dest_channel = "channel-99"
  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  let sender =
    #"3532356636653262306638613135613363393564383263383131336239396466656266653430663132346362326263373165653939653232"

  let ftpd =
    FungibleTokenPacketData {
      denom: prefixed_denom,
      amount: string.from_int(transfer_amount) |> string.to_bytearray(),
      sender,
      receiver: "cosmos address",
      memo: "",
    }

  let voucher_denom_hash = voucher_asset_name.voucher_denom_hash(ftpd.denom)
  let token_name =
    voucher_asset_name.voucher_user_token_name_from_denom_hash(voucher_denom_hash)
  let bucket_index = bucket_index_for_hash(voucher_denom_hash)
  let active_shard_name = "active-shard-0f"
  let directory_input =
    make_directory_input(
      mock_data.directory_auth_token,
      bucket_index,
      active_shard_name,
    )
  let shard_reference_input =
    make_shard_reference_input(
      mock_data.directory_auth_token.policy_id,
      active_shard_name,
      bucket_index,
      voucher_denom_hash,
      ftpd.denom,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)
  let mint_voucher_redeemer =
    RefundVoucher { packet_source_port, packet_source_channel }
  let spend_module_redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: TransferModuleData(ftpd),
      },
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      reference_inputs: [directory_input, shard_reference_input],
      outputs: [
        Output {
          address: from_verification_key(sender_public_key_hash),
          value: mint,
          datum: NoDatum,
          reference_script: None,
        },
      ],
      redeemers: [
        Pair(
          Mint(mock_data.voucher_minting_policy_id),
          mint_voucher_redeemer_in_data,
        ),
        Pair(
          Spend(mock_data.module_input.output_reference),
          spend_module_redeemer_in_data,
        ),
      ],
      mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mock_data.directory_auth_token,
    mock_data.voucher_metadata_script_hash,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}
