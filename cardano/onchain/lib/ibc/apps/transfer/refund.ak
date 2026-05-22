use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/int
use cardano/address.{from_verification_key}
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/transaction.{Input, Mint, Output, Redeemer, ScriptPurpose}
use ibc/apps/transfer/escrow as transfer_escrow
use ibc/apps/transfer/escrow.{TransferModuleSpend}
use ibc/apps/transfer/mint_voucher_redeemer.{MintVoucherRedeemer, RefundVoucher}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/value_delta
use ibc/apps/transfer/voucher_policy_registry.{
  VoucherPolicyRegistry, operational_policies,
}
use ibc/core/ics_004/types/packet.{Packet}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

pub fn validate_refund_packet_token(
  voucher_policy_registry: VoucherPolicyRegistry,
  inputs: List<Input>,
  outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  spent_input: Input,
  spend: TransferModuleSpend,
  shard_policy_id: PolicyId,
  mint: Value,
  data: FungibleTokenPacketData,
  packet: Packet,
) -> Bool {
  if transfer_coin.sender_chain_is_source(
    packet.source_port,
    packet.source_channel,
    data.denom,
  ) {
    // Source-side packets locked native funds, so timeout/ack-error refunds
    // release escrow back to the original sender address.
    expect
      !list.any(
        operational_policies(voucher_policy_registry),
        fn(policy_id) { pairs.get_first(redeemers, Mint(policy_id)) != None },
      )

    expect Some(escrowed_token_unit) =
      string_utils.hex_string_to_bytes(data.denom)
    trace @"spend_transfer_module: demon convert to token unit valid"

    let (escrowed_token_policy_id, escrowed_token_name) =
      validator_utils.extract_token_unit(escrowed_token_unit)
    trace @"spend_transfer_module: extract escrowed token valid"

    expect Some(transfer_amount) = int.from_utf8(data.amount)
    trace @"spend_transfer_module: transfer amount is valid"

    trace @"escrowed_token_policy_id": escrowed_token_policy_id
    trace @"escrowed_token_name": escrowed_token_name

    let expected_escrow_value_difference =
      assets.from_asset(
        escrowed_token_policy_id,
        escrowed_token_name,
        transfer_amount,
      )
        |> assets.negate()
    let correct_transfer_amount =
      transfer_escrow.validate_module_escrow_transition(
        spent_input,
        spend,
        inputs,
        outputs,
        transfer_escrow.transfer_escrow_datum(packet.source_channel, data.denom),
        shard_policy_id,
        mint,
        0 - transfer_amount,
        expected_escrow_value_difference,
        escrowed_token_unit,
      )

    trace @"spend_transfer_module (validate_refund_packet_token): unescrowed amount is valid"

    expect Some(sender_public_key_hash) =
      string_utils.hex_string_to_bytes(data.sender)
    let receiver_address = from_verification_key(sender_public_key_hash)

    // Check the sender's balance delta across all outputs at their address; this
    // avoids relying on a particular output index or a single payout output.
    let prev_receiver_token =
      list.reduce(
        inputs,
        0,
        fn(acc, input) {
          let output = input.output
          if output.address == receiver_address {
            let output_token =
              quantity_of(
                output.value,
                escrowed_token_policy_id,
                escrowed_token_name,
              )
            acc + output_token
          } else {
            acc
          }
        },
      )
    let post_receiver_token =
      list.reduce(
        outputs,
        0,
        fn(acc, output) {
          if output.address == receiver_address {
            let output_token =
              quantity_of(
                output.value,
                escrowed_token_policy_id,
                escrowed_token_name,
              )
            acc + output_token
          } else {
            acc
          }
        },
      )
    let receiver_delta = post_receiver_token - prev_receiver_token
    let correct_receiver_amount =
      if escrowed_token_unit == "lovelace" {
        receiver_delta >= transfer_amount
      } else {
        receiver_delta == transfer_amount
      }
    and {
      correct_transfer_amount?,
      correct_receiver_amount?,
    }
  } else {
    // Sink-side packets burned vouchers on send, so refunds remint the voucher.
    expect
      list.any(
        operational_policies(voucher_policy_registry),
        fn(policy_id) {
          validate_refund_voucher_redeemer_for_policy(redeemers, policy_id, packet)
        },
      )
    trace @"mint_voucher (validate_refund_packet_token): tx mint voucher token"

    let updated_output = transfer_escrow.expect_module_state(spend)

    value_delta.validate_output_amount(spent_input, updated_output, assets.zero)
  }
}

fn validate_refund_voucher_redeemer_for_policy(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  voucher_minting_policy_id: PolicyId,
  packet: Packet,
) -> Bool {
  when pairs.get_first(redeemers, Mint(voucher_minting_policy_id)) is {
    Some(mint_voucher_redeemer) -> {
      expect mint_voucher_redeemer: MintVoucherRedeemer = mint_voucher_redeemer
      expect RefundVoucher { packet_source_port, packet_source_channel, .. } =
        mint_voucher_redeemer

      and {
        (packet_source_port == packet.source_port)?,
        (packet_source_channel == packet.source_channel)?,
      }
    }
    None -> False
  }
}
