use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/string
use cardano/address.{from_script, from_verification_key}
use cardano/assets.{PolicyId, from_asset}
use cardano/transaction.{
  Input, Mint, NoDatum, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, RefundVoucher,
}
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/types/acknowledgement
use ibc/core/ics_004/types/acknowledgement_response.{AcknowledgementResult}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, OnAcknowledgementPacket, OnRecvPacket, OnTimeoutPacket, Operator,
  TransferModuleData, TransferModuleOperator,
}
use ibc/utils/string as string_utils
use minting_voucher

type MockData {
  module_token: AuthToken,
  voucher_minting_policy_id: PolicyId,
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
    voucher_minting_policy_id: "mint voucher policy id",
    module_input,
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

  // 525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22
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

  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
    ]

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let token_name = crypto.sha3_256(prefixed_denom)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let voucher_output =
    Output {
      address: from_verification_key(receiver_public_key_hash),
      value: mint,
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      outputs: [voucher_output],
      redeemers: redeemers,
      mint: mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
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

  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
    ]

  let token_name = crypto.sha3_256(packet_data.denom)

  let mint =
    from_asset(
      mock_data.voucher_minting_policy_id,
      token_name,
      -transfer_amount,
    )

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      redeemers: redeemers,
      mint: mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

test test_refund_voucher() {
  let mock_data = prepare_mock_data()

  //=========================arrange packet data===============================
  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"

  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  //525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22
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

  //==================================arrange output============================
  let token_name = crypto.sha3_256(ftpd.denom)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let sender_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: mint,
      datum: NoDatum,
      reference_script: None,
    }
  let outputs = [sender_output]

  //==================================arrange redeemers============================
  let mint_voucher_redeemer =
    RefundVoucher { packet_source_port, packet_source_channel }
  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let packet_data = TransferModuleData(ftpd)

  let spend_module_redeemer =
    Callback(
      OnTimeoutPacket { channel_id: packet_source_channel, data: packet_data },
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      outputs: outputs,
      redeemers: redeemers,
      mint: mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}

// ID-503-Not possible to refund voucher if transfer suceeds
test test_refund_voucher_fail() fail {
  let mock_data = prepare_mock_data()

  //=========================arrange packet data===============================
  let packet_source_port = "port-99"
  let packet_source_channel = "channel-99"
  let packet_dest_channel = "channel-99"

  let transfer_amount = 100

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_source_port, packet_source_channel)
  let prefixed_denom = bytearray.concat(source_prefix, "ibc/usdt")

  //525f6e2b0f8a15a3c95d82c8113b99dfebfe40f124cb2bc71ee99e22
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

  //==================================arrange output============================
  let token_name = crypto.sha3_256(ftpd.denom)

  let mint =
    from_asset(mock_data.voucher_minting_policy_id, token_name, transfer_amount)

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let sender_output =
    Output {
      address: from_verification_key(sender_public_key_hash),
      value: mint,
      datum: NoDatum,
      reference_script: None,
    }
  let outputs = [sender_output]

  //==================================arrange redeemers============================
  let mint_voucher_redeemer =
    RefundVoucher { packet_source_port, packet_source_channel }
  let purpose = Mint(mock_data.voucher_minting_policy_id)

  let packet_data = TransferModuleData(ftpd)

  let spend_module_redeemer =
    Callback(
      OnAcknowledgementPacket {
        channel_id: packet_dest_channel,
        acknowledgement: acknowledgement.new_result_acknowledgement(#[1]),
        data: packet_data,
      },
    )
  let mint_voucher_redeemer_in_data: Redeemer = mint_voucher_redeemer
  let spend_module_redeemer_in_data: Redeemer = spend_module_redeemer

  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(purpose, mint_voucher_redeemer_in_data),
      Pair(
        Spend(mock_data.module_input.output_reference),
        spend_module_redeemer_in_data,
      ),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [mock_data.module_input],
      outputs: outputs,
      redeemers: redeemers,
      mint: mint,
    }

  minting_voucher.mint_voucher.mint(
    mock_data.module_token,
    mint_voucher_redeemer,
    mock_data.voucher_minting_policy_id,
    transaction,
  )
}
