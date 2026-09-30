use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/address.{Script, from_script}
use cardano/assets.{AssetName, PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, Output, Redeemer, ScriptPurpose, Spend, Transaction,
}
use ibc/apps/transfer/mint_voucher_redeemer.{
  MintVoucherRedeemer, PacketBatch, ReclaimMetadata,
}
use ibc/apps/transfer/packet_batch
use ibc/apps/transfer/trace_registry.{
  InsertTrace, RolloverInsertTrace, TraceRegistryRedeemer,
}
use ibc/apps/transfer/types/coin as transfer_coin
use ibc/apps/transfer/voucher_asset_name
use ibc/apps/transfer/voucher_metadata as voucher_metadata_datum
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config
use ibc/utils/shutdown
use ibc/utils/validator_utils

validator mint_voucher(
  _module_token: AuthToken,
  _directory_auth_token: AuthToken,
  voucher_metadata_script_hash: crypto.ScriptHash,
  _channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  config_token: AuthToken,
) {
  mint(
    redeemer: MintVoucherRedeemer,
    voucher_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, reference_inputs, outputs, mint, redeemers, .. } =
      transaction

    when redeemer is {
      PacketBatch -> {
        let config = packet_config.reference(transaction, config_token)
        let op = packet_batch.operation(transaction, config.batch_policy)
        when op is {
          packet_batch.SendBatch { intents, .. } -> {
            let burns =
              list.foldl(
                intents,
                dict.empty,
                fn(ref, burns) {
                  let input = packet_batch.input_at(transaction, ref)
                  expect intent: packet_batch.TransferIntent =
                    validator_utils.get_inline_datum(input.output)
                  if transfer_coin.sender_chain_is_source(
                    intent.port_id,
                    intent.channel_id,
                    intent.data.denom,
                  ) {
                    burns
                  } else {
                    expect Some(amount) = int.from_utf8(intent.data.amount)
                    expect amount > 0
                    let name =
                      voucher_asset_name.voucher_user_token_name(
                        intent.data.denom,
                      )
                    let previous =
                      when dict.get(burns, name) is {
                        Some(value) -> value
                        None -> 0
                      }
                    dict.insert(burns, name, previous - amount)
                  }
                },
              )
            expect !dict.is_empty(burns)
            tokens(mint, voucher_minting_policy_id) == burns
          }
          _ -> {
            let (full_denom, data) =
              when op is {
                packet_batch.Receive { packet, data, .. } -> {
                  expect
                    !transfer_coin.receiver_chain_is_source(
                      packet.source_port,
                      packet.source_channel,
                      data.denom,
                    )
                  (
                    bytearray.concat(
                      transfer_coin.get_denom_prefix(
                        packet.destination_port,
                        packet.destination_channel,
                      ),
                      data.denom,
                    ),
                    data,
                  )
                }
                packet_batch.Timeout { packet, data, .. } |
                packet_batch.TimeoutOnClose { packet, data, .. } |
                packet_batch.Reject { packet, data, .. } -> {
                  expect
                    !transfer_coin.sender_chain_is_source(
                      packet.source_port,
                      packet.source_channel,
                      data.denom,
                    )
                  (data.denom, data)
                }
                _ -> fail
              }
            let hash = voucher_asset_name.voucher_denom_hash(full_denom)
            let user_name =
              voucher_asset_name.voucher_user_token_name_from_denom_hash(hash)
            let reference_name =
              voucher_asset_name.voucher_reference_token_name_from_denom_hash(
                hash,
              )
            let completeness =
              trace_registry_completeness_satisfied(
                inputs,
                reference_inputs,
                redeemers,
                config.trace_registry_hash,
                voucher_minting_policy_id,
                voucher_metadata_script_hash,
                hash,
                full_denom,
              )
            expect Some(amount) = int.from_utf8(data.amount)
            expect amount > 0
            and {
              positive_voucher_mint_matches(
                tokens(mint, voucher_minting_policy_id),
                user_name,
                reference_name,
                amount,
                completeness,
              ),
              metadata_output_valid(
                outputs,
                full_denom,
                user_name,
                voucher_minting_policy_id,
                reference_name,
                voucher_metadata_script_hash,
                completeness,
              ),
            }
          }
        }
      }
      ReclaimMetadata -> {
        expect _ = shutdown.authority(transaction, host_state_nft_policy_id)
        expect
          shutdown.transfer_is_drained(transaction, host_state_nft_policy_id)
        expect shutdown.burns_only(mint, voucher_minting_policy_id)
        list.all(
          tokens(mint, voucher_minting_policy_id) |> dict.to_pairs,
          fn(entry) {
            let Pair(name, quantity) = entry
            and {
              voucher_asset_name.is_voucher_reference_token_name(name),
              quantity == -1,
              list.any(
                inputs,
                fn(input) {
                  input.output.address.payment_credential == Script(
                    voucher_metadata_script_hash,
                  ) && quantity_of(
                    input.output.value,
                    voucher_minting_policy_id,
                    name,
                  ) == 1
                },
              ),
            }
          },
        )
      }

      _ -> False
    }
  }

  else(_) {
    fail
  }
}

type TraceRegistryCompleteness {
  ExistingMapping
  FirstSeenMapping
}

// Every positive voucher mint must prove registry completeness in the same tx.
// The tx may either:
// - carry the immutable CIP-68 reference NFT proving the exact mapping already
//   exists, or
// - spend the pinned registry script with the exact new mapping. That script
//   authenticates the directory, shard identity, absence and continuation.
//
// Existing mappings intentionally do not depend on the growing registry
// directory or archived shard list. This keeps re-mints/refunds usable even
// after a bucket stops accepting new denominations.
fn trace_registry_completeness_satisfied(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  trace_registry_hash: ByteArray,
  voucher_minting_policy_id: PolicyId,
  voucher_metadata_script_hash: crypto.ScriptHash,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Option<TraceRegistryCompleteness> {
  if existing_metadata_mapping_present(
    reference_inputs,
    voucher_minting_policy_id,
    voucher_metadata_script_hash,
    voucher_hash,
    full_denom,
  ) {
    Some(ExistingMapping)
  } else {
    if list.any(
      inputs,
      fn(input) {
        if input.output.address.payment_credential != Script(
          trace_registry_hash,
        ) {
          False
        } else {
          when pairs.get_first(redeemers, Spend(input.output_reference)) is {
            None -> False
            Some(raw) -> {
              expect action: TraceRegistryRedeemer = raw
              when action is {
                InsertTrace {
                  voucher_hash: actual_hash,
                  full_denom: actual_denom,
                } |
                RolloverInsertTrace {
                  voucher_hash: actual_hash,
                  full_denom: actual_denom,
                  ..
                } -> actual_hash == voucher_hash && actual_denom == full_denom
                _ -> False
              }
            }
          }
        }
      },
    ) {
      Some(FirstSeenMapping)
    } else {
      None
    }
  }
}

fn existing_metadata_mapping_present(
  reference_inputs: List<Input>,
  voucher_minting_policy_id: PolicyId,
  voucher_metadata_script_hash: crypto.ScriptHash,
  voucher_hash: ByteArray,
  full_denom: ByteArray,
) -> Bool {
  let reference_token_name =
    voucher_asset_name.voucher_reference_token_name_from_denom_hash(
      voucher_hash,
    )
  let expected_value =
    assets.from_asset(voucher_minting_policy_id, reference_token_name, 1)
  let metadata_address = from_script(voucher_metadata_script_hash)

  list.length(
    list.filter(
      reference_inputs,
      fn(input) {
        let output = input.output

        if output.address != metadata_address || assets.without_lovelace(
          output.value,
        ) != expected_value {
          False
        } else {
          when output.datum is {
            InlineDatum(datum) ->
              datum == voucher_metadata_datum.build_datum(
                full_denom,
                voucher_asset_name.voucher_user_token_name_from_denom_hash(
                  voucher_hash,
                ),
                voucher_minting_policy_id,
              )
            _ -> False
          }
        }
      },
    ),
  ) == 1
}

fn positive_voucher_mint_matches(
  minted_tokens,
  user_token_name: AssetName,
  reference_token_name: AssetName,
  transfer_amount: Int,
  registry_completeness: Option<TraceRegistryCompleteness>,
) -> Bool {
  when registry_completeness is {
    Some(ExistingMapping) ->
      minted_tokens == (
        dict.empty
          |> dict.insert(user_token_name, transfer_amount)
      )

    Some(FirstSeenMapping) ->
      minted_tokens == (
        dict.empty
          |> dict.insert(user_token_name, transfer_amount)
          |> dict.insert(reference_token_name, 1)
      )

    None -> False
  }
}

fn metadata_output_valid(
  outputs: List<Output>,
  full_denom: ByteArray,
  user_token_name: AssetName,
  voucher_policy_id: PolicyId,
  reference_token_name: AssetName,
  voucher_metadata_script_hash: crypto.ScriptHash,
  registry_completeness: Option<TraceRegistryCompleteness>,
) -> Bool {
  let metadata_address = from_script(voucher_metadata_script_hash)
  let metadata_outputs =
    list.filter(
      outputs,
      fn(output) {
        output.address == metadata_address && quantity_of(
          output.value,
          voucher_policy_id,
          reference_token_name,
        ) == 1
      },
    )

  when registry_completeness is {
    Some(ExistingMapping) -> list.length(metadata_outputs) == 0

    Some(FirstSeenMapping) ->
      when metadata_outputs is {
        [metadata_output] -> {
          expect [policy_id] =
            metadata_output.value
              |> assets.without_lovelace
              |> assets.policies()
          expect [token_name] =
            assets.tokens(metadata_output.value, voucher_policy_id)
              |> dict.keys()
          expect InlineDatum(metadata_datum) = metadata_output.datum

          policy_id == voucher_policy_id && token_name == reference_token_name && metadata_datum == voucher_metadata_datum.build_datum(
            full_denom,
            user_token_name,
            voucher_policy_id,
          )
        }

        _ -> False
      }

    None -> False
  }
}
