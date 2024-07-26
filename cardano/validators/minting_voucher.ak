use aiken/bytearray
use aiken/dict
use aiken/hash
use aiken/int
use aiken/list
use aiken/pairs
use aiken/string
use aiken/transaction.{
  Input, Mint, NoDatum, Output, OutputReference, Redeemer, ScriptContext,
  ScriptPurpose, Spend, Transaction, TransactionId,
}
use aiken/transaction/credential
use aiken/transaction/value.{PolicyId}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer, RefundVoucher,
}
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/types/acknowledgement
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnAcknowledgementPacket, OnRecvPacket,
  OnTimeoutPacket, Operator, TransferModuleData, TransferModuleOperator,
}
use ibc/utils/string as string_utils

validator(module_token: AuthToken) {
  fn mint_voucher(redeemer: MintVoucherRedeemer, context: ScriptContext) -> Bool {
    let ScriptContext { transaction, purpose } = context
    expect Mint(voucher_minting_policy_id) = purpose
    let Transaction { inputs, outputs, mint, redeemers, .. } = transaction

    expect
      when redeemer is {
        MintVoucher {
          packet_source_port,
          packet_source_channel,
          packet_dest_port,
          packet_dest_channel,
        } -> {
          trace @"mint_voucher: MintVoucher branch"

          expect Callback(ibc_module_callback) =
            extract_module_redeemer(inputs, redeemers, module_token)
          expect OnRecvPacket { data, .. } = ibc_module_callback
          expect TransferModuleData(data) = data
          trace @"mint_voucher: module redeemer is valid"

          expect
            !transfer_coin.receiver_chain_is_source(
              packet_source_port,
              packet_source_channel,
              data.denom,
            )
          trace @"mint_voucher: receiver chain is not source"

          let source_prefix =
            transfer_coin.get_denom_prefix(
              packet_dest_port,
              packet_dest_channel,
            )
          let prefixed_denom = bytearray.concat(source_prefix, data.denom)
          let token_name = hash.sha3_256(prefixed_denom)

          expect Some(transfer_amount) = int.from_utf8(data.amount)

          let minted_tokens =
            value.from_minted_value(mint)
              |> value.tokens(voucher_minting_policy_id)
          expect
            minted_tokens == (
              dict.new()
                |> dict.insert(token_name, transfer_amount)
            )
          trace @"mint_voucher: minted token is valid"

          expect Some(receiver_public_key_hash) =
            string_utils.hex_string_to_bytes(data.receiver)
          trace @"mint_voucher: converted receiver to public key hash"
          let receiver_address =
            credential.from_verification_key(receiver_public_key_hash)

          let inputs_token =
            list.reduce(
              inputs,
              0,
              fn(acc, input) {
                let output = input.output

                if output.address == receiver_address {
                  let output_token =
                    value.quantity_of(
                      output.value,
                      voucher_minting_policy_id,
                      token_name,
                    )
                  acc + output_token
                } else {
                  acc
                }
              },
            )

          let outputs_token =
            list.reduce(
              outputs,
              0,
              fn(acc, output) {
                if output.address == receiver_address {
                  let output_token =
                    value.quantity_of(
                      output.value,
                      voucher_minting_policy_id,
                      token_name,
                    )
                  acc + output_token
                } else {
                  acc
                }
              },
            )
          expect outputs_token - inputs_token == transfer_amount
          trace @"mint_voucher: receiver's utxos contain valid token"

          True
        }
        BurnVoucher { packet_source_port, packet_source_channel } -> {
          trace @"mint_voucher: MintVoucher branch"

          expect Operator(ibc_module_operator) =
            extract_module_redeemer(inputs, redeemers, module_token)
          expect TransferModuleOperator(ibc_module_operator) =
            ibc_module_operator
          expect Transfer { data, .. } = ibc_module_operator
          trace @"mint_voucher: module redeemer is valid"

          expect
            !transfer_coin.sender_chain_is_source(
              packet_source_port,
              packet_source_channel,
              data.denom,
            )
          trace @"mint_voucher: sender chain is not source"

          expect Some(transfer_amount) = int.from_utf8(data.amount)

          let token_name = hash.sha3_256(data.denom)
          let minted_tokens =
            value.from_minted_value(mint)
              |> value.tokens(voucher_minting_policy_id)
          expect
            minted_tokens == (
              dict.new()
                |> dict.insert(token_name, -transfer_amount)
            )
          trace @"mint_voucher: burned token is valid"

          True
        }
        RefundVoucher { packet_source_port, packet_source_channel } -> {
          trace @"mint_voucher: RefundVoucher branch"

          expect Callback(ibc_module_callback) =
            extract_module_redeemer(inputs, redeemers, module_token)
          let data =
            when ibc_module_callback is {
              OnTimeoutPacket { data, .. } -> data
              OnAcknowledgementPacket { data, .. } -> data
              _ -> fail
            }
          expect TransferModuleData(data) = data
          trace @"mint_voucher: module redeemer is valid"

          expect
            !transfer_coin.sender_chain_is_source(
              packet_source_port,
              packet_source_channel,
              data.denom,
            )
          trace @"mint_voucher: sender chain is not source"

          expect Some(transfer_amount) = int.from_utf8(data.amount)

          let token_name = hash.sha3_256(data.denom)

          let minted_tokens =
            value.from_minted_value(mint)
              |> value.tokens(voucher_minting_policy_id)
          expect
            minted_tokens == (
              dict.new()
                |> dict.insert(token_name, transfer_amount)
            )
          trace @"mint_voucher: minted token is valid"

          expect Some(sender_public_key_hash) =
            string_utils.hex_string_to_bytes(data.sender)
          trace @"mint_voucher: converted sender to public key hash"

          let sender_address =
            credential.from_verification_key(sender_public_key_hash)

          let inputs_token =
            list.reduce(
              inputs,
              0,
              fn(acc, input) {
                let output = input.output

                if output.address == sender_address {
                  let output_token =
                    value.quantity_of(
                      output.value,
                      voucher_minting_policy_id,
                      token_name,
                    )
                  acc + output_token
                } else {
                  acc
                }
              },
            )

          let outputs_token =
            list.reduce(
              outputs,
              0,
              fn(acc, output) {
                if output.address == sender_address {
                  let output_token =
                    value.quantity_of(
                      output.value,
                      voucher_minting_policy_id,
                      token_name,
                    )
                  acc + output_token
                } else {
                  acc
                }
              },
            )
          expect outputs_token - inputs_token == transfer_amount
          trace @"mint_voucher: sender's utxos contain valid token"

          True
        }
      }

    True
  }
}

fn extract_module_redeemer(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  module_token: AuthToken,
) -> IBCModuleRedeemer {
  expect Some(module_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(module_token) },
    )

  // validate spend channel redeemer
  expect Some(spend_module_redeemer) =
    pairs.get_first(redeemers, Spend(module_input.output_reference))

  expect spend_module_redeemer: IBCModuleRedeemer = spend_module_redeemer

  spend_module_redeemer
}

//===================================================TEST========================================================

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
        transaction_id: TransactionId { hash: "transaction id" },
        output_index: 0,
      },
      output: Output {
        address: credential.from_script("spend module output address"),
        value: value.from_asset(module_token.policy_id, module_token.name, 1),
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
      Pair(Spend(mock_data.module_input.output_reference),
      spend_module_redeemer_in_data),
    ]

  let source_prefix =
    transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
  let prefixed_denom = bytearray.concat(source_prefix, ftpd.denom)
  let token_name = hash.sha3_256(prefixed_denom)

  let token_value =
    value.from_asset(
      mock_data.voucher_minting_policy_id,
      token_name,
      transfer_amount,
    )

  let mint = value.to_minted_value(token_value)

  expect Some(receiver_public_key_hash) =
    string_utils.hex_string_to_bytes(receiver)

  let voucher_output =
    Output {
      address: credential.from_verification_key(receiver_public_key_hash),
      value: token_value,
      datum: NoDatum,
      reference_script: None,
    }

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [mock_data.module_input],
      outputs: [voucher_output],
      redeemers: redeemers,
      mint: mint,
    }

  let context = ScriptContext { purpose, transaction }

  mint_voucher(mock_data.module_token, mint_voucher_redeemer, context)
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
      Pair(Spend(mock_data.module_input.output_reference),
      spend_module_redeemer_in_data),
    ]

  let token_name = hash.sha3_256(packet_data.denom)

  let token_value =
    value.from_asset(
      mock_data.voucher_minting_policy_id,
      token_name,
      -transfer_amount,
    )
  let mint = value.to_minted_value(token_value)

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [mock_data.module_input],
      redeemers: redeemers,
      mint: mint,
    }

  let context = ScriptContext { purpose, transaction }

  mint_voucher(mock_data.module_token, mint_voucher_redeemer, context)
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
  let token_name = hash.sha3_256(ftpd.denom)

  let token_value =
    value.from_asset(
      mock_data.voucher_minting_policy_id,
      token_name,
      transfer_amount,
    )

  expect Some(sender_public_key_hash) = string_utils.hex_string_to_bytes(sender)

  let sender_output =
    Output {
      address: credential.from_verification_key(sender_public_key_hash),
      value: token_value,
      datum: NoDatum,
      reference_script: None,
    }
  let outputs =
    [sender_output]

  //==================================arrange mint============================
  let mint = value.to_minted_value(token_value)

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
      Pair(Spend(mock_data.module_input.output_reference),
      spend_module_redeemer_in_data),
    ]

  let transaction =
    Transaction {
      ..transaction.placeholder(),
      inputs: [mock_data.module_input],
      outputs: outputs,
      redeemers: redeemers,
      mint: mint,
    }

  let context = ScriptContext { purpose, transaction }

  mint_voucher(mock_data.module_token, mint_voucher_redeemer, context)
}
