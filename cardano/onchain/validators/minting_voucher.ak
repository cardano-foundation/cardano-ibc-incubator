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
use ibc/apps/transfer/trace_registry.{
  Directory, InsertTrace, RolloverInsertTrace, Shard, TraceRegistryDatum,
  TraceRegistryDirectoryBucket, TraceRegistryRedeemer, bucket_index_for_hash,
}
use ibc/apps/transfer/transfer_module_redeemer.{Transfer}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/types/acknowledgement_response.{AcknowledgementError}
use ibc/core/ics_005/types/ibc_module_redeemer.{
  Callback, IBCModuleRedeemer, OnAcknowledgementPacket, OnRecvPacket,
  OnTimeoutPacket, Operator, TransferModuleData, TransferModuleOperator,
}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_voucher(
  module_token: AuthToken,
  directory_auth_token: AuthToken,
) {
  mint(
    redeemer: MintVoucherRedeemer,
    voucher_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, reference_inputs, outputs, mint, redeemers, .. } =
      transaction

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
        trace @"mint_voucher: valid receiver?": valid_receiver

        let source_prefix =
          transfer_coin.get_denom_prefix(packet_dest_port, packet_dest_channel)
        let prefixed_denom = bytearray.concat(source_prefix, data.denom)
        let token_name = crypto.sha3_256(prefixed_denom)
        let registry_completeness_satisfied =
          trace_registry_completeness_satisfied(
            inputs,
            reference_inputs,
            redeemers,
            directory_auth_token,
            token_name,
            prefixed_denom,
          )

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

        // There should be just one output with the receiver address AND tokens of the voucher minting policy
        expect [payout_output] =
          list.filter(
            transaction.outputs,
            fn(output) {
              and {
                output.address == receiver_address,
                (
                  output.value
                    |> assets.without_lovelace
                    |> assets.policies
                ) == [voucher_minting_policy_id],
              }
            },
          )

        and {
          valid_receiver?,
          valid_minted_tokens?,
          registry_completeness_satisfied,
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
            OnAcknowledgementPacket { acknowledgement, data, .. } ->
              when acknowledgement.response is {
                AcknowledgementError { .. } -> data
                _ -> fail
              }
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
        let registry_completeness_satisfied =
          trace_registry_completeness_satisfied(
            inputs,
            reference_inputs,
            redeemers,
            directory_auth_token,
            token_name,
            data.denom,
          )

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
          registry_completeness_satisfied,
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

// Every positive voucher mint must prove registry completeness in the same tx.
// The tx may either:
// - spend the active shard with a matching trace-registry write redeemer, or
// - carry reference inputs proving the exact mapping already exists on-chain.
fn trace_registry_completeness_satisfied(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  directory_auth_token: AuthToken,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Bool {
  let directory_bucket =
    find_directory_bucket_witness(
      inputs,
      reference_inputs,
      directory_auth_token,
      bucket_index_for_hash(voucher_hash),
    )

  matching_registry_update_present(
    inputs,
    redeemers,
    directory_auth_token,
    directory_bucket.active_shard_name,
    voucher_hash,
    full_denom,
  ) || existing_registry_mapping_present(
    reference_inputs,
    directory_bucket,
    directory_auth_token,
    voucher_hash,
    full_denom,
  )
}

fn find_directory_bucket_witness(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  directory_auth_token: AuthToken,
  bucket_index: Int,
) -> TraceRegistryDirectoryBucket {
  expect [directory_input] =
    list.filter(
      list.concat(inputs, reference_inputs),
      fn(input) { input.output |> auth.contain_auth_token(directory_auth_token) },
    )

  expect Directory(directory): TraceRegistryDatum =
    validator_utils.get_inline_datum(directory_input.output)
  expect Some(bucket) =
    list.find(directory.buckets, fn(candidate) {
      candidate.bucket_index == bucket_index
    })

  bucket
}

fn matching_registry_update_present(
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  directory_auth_token: AuthToken,
  active_shard_name: ByteArray,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Bool {
  let active_shard_token =
    AuthToken {
      policy_id: directory_auth_token.policy_id,
      name: active_shard_name,
    }

  when list.find(inputs, fn(input) {
    input.output |> auth.contain_auth_token(active_shard_token)
  }) is {
    Some(active_shard_input) -> {
      expect Shard(_): TraceRegistryDatum =
        validator_utils.get_inline_datum(active_shard_input.output)

      when pairs.get_first(redeemers, Spend(active_shard_input.output_reference)) is {
        Some(trace_registry_redeemer) -> {
          expect trace_registry_redeemer: TraceRegistryRedeemer =
            trace_registry_redeemer

          when trace_registry_redeemer is {
            InsertTrace {
              voucher_hash: redeemer_hash,
              full_denom: redeemer_full_denom,
            } ->
              redeemer_hash == voucher_hash &&
                redeemer_full_denom == full_denom

            RolloverInsertTrace {
              voucher_hash: redeemer_hash,
              full_denom: redeemer_full_denom,
              ..
            } ->
              redeemer_hash == voucher_hash &&
                redeemer_full_denom == full_denom

            _ -> False
          }
        }

        None -> False
      }
    }

    None -> False
  }
}

fn existing_registry_mapping_present(
  reference_inputs: List<Input>,
  directory_bucket: TraceRegistryDirectoryBucket,
  directory_auth_token: AuthToken,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Bool {
  list.any(
    list.concat(
      [directory_bucket.active_shard_name],
      directory_bucket.archived_shard_names,
    ),
    fn(shard_name) {
      let shard_token =
        AuthToken {
          policy_id: directory_auth_token.policy_id,
          name: shard_name,
        }

      when list.find(reference_inputs, fn(input) {
        input.output |> auth.contain_auth_token(shard_token)
      }) is {
        Some(shard_input) -> {
          expect Shard(shard): TraceRegistryDatum =
            validator_utils.get_inline_datum(shard_input.output)

          list.any(shard.entries, fn(entry) {
            entry.voucher_hash == voucher_hash && entry.full_denom == full_denom
          })
        }

        None -> False
      }
    },
  )
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
    (quantity_of(voucher_output_value, voucher_policy_id, asset_name) == transfer_amount)?,
  }
}
