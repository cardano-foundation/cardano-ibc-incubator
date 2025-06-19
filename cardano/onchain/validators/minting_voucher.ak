use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{from_verification_key}
use cardano/assets.{AssetName, PolicyId, quantity_of, tokens}
use cardano/transaction.{
  Input, Output, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer, RefundVoucher,
}
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnAcknowledgementPacket, OnRecvPacket,
  OnTimeoutPacket, Operator, TransferModuleData, TransferModuleOperator,
}
use ibc/utils/string as string_utils

validator mint_voucher(module_token: AuthToken) {
  mint(
    redeemer: MintVoucherRedeemer,
    voucher_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, redeemers, .. } = transaction

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

        let valid_receiver =
          !transfer_coin.receiver_chain_is_source(
            packet_source_port,
            packet_source_channel,
            data.denom,
          )
        trace @"mint_voucher: receiver chain is not source"

        let source_prefix =
          transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
        let prefixed_denom = bytearray.concat(source_prefix, data.denom)
        let token_name = crypto.sha3_256(prefixed_denom)

        expect Some(transfer_amount) = int.from_utf8(data.amount)

        let minted_tokens = tokens(mint, voucher_minting_policy_id)
        let valid_minted_tokens =
          minted_tokens == (
            dict.empty
              |> dict.insert(token_name, transfer_amount)
          )
        trace @"mint_voucher: minted token is valid"

        expect Some(receiver_public_key_hash) =
          string_utils.hex_string_to_bytes(data.receiver)
        trace @"mint_voucher: converted receiver to public key hash"
        let receiver_address = from_verification_key(receiver_public_key_hash)

        expect Some(payout_output) =
          list.find(
            transaction.outputs,
            fn(output) { output.address == receiver_address },
          )

        and {
          valid_receiver?,
          valid_minted_tokens?,
          valid_voucher_output(
            payout_output,
            voucher_minting_policy_id,
            token_name,
            transfer_amount,
          )?,
        }
      }
      BurnVoucher { packet_source_port, packet_source_channel } -> {
        trace @"mint_voucher: MintVoucher branch"

        expect Operator(ibc_module_operator) =
          extract_module_redeemer(inputs, redeemers, module_token)
        expect TransferModuleOperator(ibc_module_operator) = ibc_module_operator
        expect Transfer { data, .. } = ibc_module_operator
        trace @"mint_voucher: module redeemer is valid"

        let valid_sender =
          !transfer_coin.sender_chain_is_source(
            packet_source_port,
            packet_source_channel,
            data.denom,
          )
        trace @"mint_voucher: sender chain is not source"

        expect Some(transfer_amount) = int.from_utf8(data.amount)

        let token_name = crypto.sha3_256(data.denom)
        let minted_tokens = tokens(mint, voucher_minting_policy_id)
        let valid_minted_tokens =
          minted_tokens == (
            dict.empty
              |> dict.insert(token_name, -transfer_amount)
          )
        and {
          valid_sender,
          valid_minted_tokens,
        }
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

        let valid_sender =
          !transfer_coin.sender_chain_is_source(
            packet_source_port,
            packet_source_channel,
            data.denom,
          )
        trace @"mint_voucher: sender chain is not source"

        expect Some(transfer_amount) = int.from_utf8(data.amount)

        let token_name = crypto.sha3_256(data.denom)

        let minted_tokens = tokens(mint, voucher_minting_policy_id)
        let valid_minted_tokens =
          minted_tokens == (
            dict.empty
              |> dict.insert(token_name, transfer_amount)
          )
        trace @"mint_voucher: minted token is valid"

        expect Some(sender_public_key_hash) =
          string_utils.hex_string_to_bytes(data.sender)
        trace @"mint_voucher: converted sender to public key hash"

        let sender_address = from_verification_key(sender_public_key_hash)

        let inputs_token =
          list.reduce(
            inputs,
            0,
            fn(acc, input) {
              let output = input.output

              if output.address == sender_address {
                let output_token =
                  quantity_of(
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
                  quantity_of(
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
        and {
          outputs_token - inputs_token == transfer_amount,
          valid_minted_tokens,
          valid_sender,
        }
      }
    }
  }

  else(_) {
    fail
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

// Checks transfer amount is valid gte than the expected one
// And that there is no token dust injection.
fn valid_voucher_output(
  voucher_output: Output,
  voucher_policy_id: PolicyId,
  asset_name: AssetName,
  transfer_amount: Int,
) -> Bool {
  let voucher_output_value = assets.without_lovelace(voucher_output.value)
  expect [actual_policy_id] = assets.policies(voucher_output_value)
  and {
    (actual_policy_id == voucher_policy_id)?,
    (quantity_of(voucher_output_value, voucher_policy_id, asset_name) >= transfer_amount)?,
  }
}
