use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, Transaction}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/transfer_escrow_shard_redeemer.{
  CreateEscrowShard, CreateEscrowShardV2, RetireEscrowShard,
  TransferEscrowShardRedeemer,
}
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/channel_datum.{ChannelDatum} as channel_datum_mod
use ibc/core/ics_004/types/keys as channel_keys
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/core/ics_025_handler_interface/reclamation
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

validator mint_transfer_escrow_shard(
  transfer_port_token: AuthToken,
  transfer_port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
) {
  mint(
    redeemer: TransferEscrowShardRedeemer,
    transfer_escrow_shard_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, .. } = transaction

    when redeemer is {
      // Constructor 0 is retained for wire compatibility only. Fresh policies
      // require the count-authenticated V2 transition.
      CreateEscrowShard { .. } -> False
      CreateEscrowShardV2 {
        channel_id,
        denom,
        data,
        registry_siblings,
        old_channel_live_escrow_shard_count,
        channel_live_escrow_shard_count_siblings,
      } ->
        validate_create_escrow_shard(
          inputs,
          outputs,
          mint,
          transfer_escrow_shard_policy_id,
          transfer_port_token,
          channel_id,
          denom,
          data,
          registry_siblings,
          old_channel_live_escrow_shard_count,
          channel_live_escrow_shard_count_siblings,
        )
      RetireEscrowShard {
        transfer_port_token: redeemer_transfer_port_token,
        channel_id,
        denom,
        registry_siblings,
        old_channel_live_escrow_shard_count,
        channel_live_escrow_shard_count_siblings,
      } -> {
        expect redeemer_transfer_port_token == transfer_port_token
        validate_retire_escrow_shard(
          transaction,
          transfer_escrow_shard_policy_id,
          transfer_port_token,
          transfer_port_id,
          channel_minting_policy_id,
          host_state_nft_policy_id,
          channel_id,
          denom,
          registry_siblings,
          old_channel_live_escrow_shard_count,
          channel_live_escrow_shard_count_siblings,
        )
      }
    }
  }

  else(_) {
    fail
  }
}

fn validate_create_escrow_shard(
  inputs: List<Input>,
  outputs: List<Output>,
  mint,
  transfer_escrow_shard_policy_id: PolicyId,
  transfer_port_token: AuthToken,
  channel_id: ByteArray,
  denom: ByteArray,
  data: FungibleTokenPacketData,
  registry_siblings: List<ByteArray>,
  old_channel_live_escrow_shard_count: Int,
  channel_live_escrow_shard_count_siblings: List<ByteArray>,
) -> Bool {
  // Tie shard creation to the exact packet denom and amount.
  expect data.denom == denom
  expect fungible_token_packet_data.validate_basic(data)

  // Native escrow denoms are encoded Cardano token units.
  expect Some(escrowed_token_unit) = string_utils.hex_string_to_bytes(denom)
  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  expect Some(transfer_amount) = int.from_utf8(data.amount)

  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  let shard_token =
    AuthToken {
      policy_id: transfer_escrow_shard_policy_id,
      name: shard_token_name,
    }

  // Creation consumes the transfer root so permanent membership is recorded
  // before this shard NFT can exist.
  let (module_state_input, module_state_output, old_datum, new_datum) =
    transfer_module_registry_transition(inputs, outputs, transfer_port_token)
  let root_after_live_marker =
    ibc_state_commitment.apply_update(
      old_datum.escrow_shard_registry_root,
      transfer_escrow_shard.shard_registry_key(channel_id, denom),
      "",
      transfer_escrow_shard.live_shard_value,
      registry_siblings,
    )
  let old_channel_count_value =
    if old_channel_live_escrow_shard_count == 0 {
      ""
    } else {
      reclamation.encode_count(old_channel_live_escrow_shard_count)
    }
  let expected_registry_root =
    ibc_state_commitment.apply_update(
      root_after_live_marker,
      transfer_escrow_shard.channel_live_shard_count_key(channel_id),
      old_channel_count_value,
      reclamation.encode_count(old_channel_live_escrow_shard_count + 1),
      channel_live_escrow_shard_count_siblings,
    )

  expect [created_output] =
    list.filter(
      outputs,
      fn(output) {
        and {
          output.address == module_state_input.output.address,
          output |> auth.contain_auth_token(shard_token),
        }
      },
    )
  expect InlineDatum(datum) = created_output.datum
  expect datum: TransferEscrowDatum = datum

  // Lovelace may exceed the packet amount because of min-ADA.
  let created_quantity =
    quantity_of(
      created_output.value,
      escrowed_token_policy_id,
      escrowed_token_name,
    )

  and {
    // Mint exactly one shard NFT and no other shard-policy tokens.
    tokens(mint, transfer_escrow_shard_policy_id) == (
      dict.empty
        |> dict.insert(shard_token_name, 1)
    ),
    // The datum must match the shard NFT derivation inputs.
    datum == TransferEscrowDatum {
      channel_id,
      denom,
      escrowed_amount: transfer_amount,
    },
    old_channel_live_escrow_shard_count >= 0,
    old_datum.live_escrow_shard_count >= 0,
    new_datum.escrow_shard_registry_root == expected_registry_root,
    new_datum.live_escrow_shard_count == old_datum.live_escrow_shard_count + 1,
    new_datum.voucher_supply == old_datum.voucher_supply,
    assets.match_assets(
      module_state_output.value,
      module_state_input.output.value,
    ),
    assets.lovelace_of(module_state_output.value) >= assets.lovelace_of(
      module_state_input.output.value,
    ),
    escrow_shard_value_is_canonical(
      created_output,
      transfer_escrow_shard_policy_id,
      shard_token_name,
      escrowed_token_unit,
    )?,
    if escrowed_token_unit == "lovelace" {
      created_quantity >= transfer_amount
    } else {
      created_quantity == transfer_amount
    },
  }
}

fn validate_retire_escrow_shard(
  transaction: Transaction,
  transfer_escrow_shard_policy_id: PolicyId,
  transfer_port_token: AuthToken,
  transfer_port_id: ByteArray,
  channel_minting_policy_id: PolicyId,
  host_state_nft_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
  registry_siblings: List<ByteArray>,
  old_channel_live_escrow_shard_count: Int,
  channel_live_escrow_shard_count_siblings: List<ByteArray>,
) -> Bool {
  let Transaction {
    inputs,
    reference_inputs,
    outputs,
    mint,
    validity_range,
    ..
  } = transaction
  expect channel_keys.is_valid_channel_id(channel_id)
  let channel_sequence = channel_keys.parse_channel_id_sequence(channel_id)
  let host_state_nft =
    AuthToken {
      policy_id: host_state_nft_policy_id,
      name: host_state_token_name,
    }
  let channel_token =
    AuthToken {
      policy_id: channel_minting_policy_id,
      name: auth.generate_token_name(
        host_state_nft,
        channel_keys.channel_prefix,
        channel_sequence,
      ),
    }
  expect [channel_witness] =
    list.filter(
      list.concat(inputs, reference_inputs),
      fn(input) { input.output |> auth.contain_auth_token(channel_token) },
    )
  expect channel_datum: ChannelDatum =
    validator_utils.get_inline_datum(channel_witness.output)

  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  let shard_token =
    AuthToken {
      policy_id: transfer_escrow_shard_policy_id,
      name: shard_token_name,
    }
  let (module_state_input, module_state_output, old_datum, new_datum) =
    transfer_module_registry_transition(inputs, outputs, transfer_port_token)
  // Retirement is a one-shard operation. Restrict the whole transaction to
  // the target shard so another shard cannot be co-spent under this policy
  // action and moved without updating its registry entry and counts.
  expect [shard_input] =
    list.filter(
      inputs,
      fn(input) {
        !(input.output.value
          |> tokens(transfer_escrow_shard_policy_id)
          |> dict.is_empty)
      },
    )
  expect shard_input.output |> auth.contain_auth_token(shard_token)
  expect shard_datum: TransferEscrowDatum =
    validator_utils.get_inline_datum(shard_input.output)
  expect Some(escrowed_token_unit) = string_utils.hex_string_to_bytes(denom)

  let root_after_retired_marker =
    ibc_state_commitment.apply_update(
      old_datum.escrow_shard_registry_root,
      transfer_escrow_shard.shard_registry_key(channel_id, denom),
      transfer_escrow_shard.live_shard_value,
      transfer_escrow_shard.retired_shard_value,
      registry_siblings,
    )
  let new_channel_count_value =
    if old_channel_live_escrow_shard_count == 1 {
      ""
    } else {
      reclamation.encode_count(old_channel_live_escrow_shard_count - 1)
    }
  let expected_registry_root =
    ibc_state_commitment.apply_update(
      root_after_retired_marker,
      transfer_escrow_shard.channel_live_shard_count_key(channel_id),
      reclamation.encode_count(old_channel_live_escrow_shard_count),
      new_channel_count_value,
      channel_live_escrow_shard_count_siblings,
    )
  let expected_module_value =
    module_state_input.output.value
      |> assets.merge(shard_input.output.value)
      |> assets.add(transfer_escrow_shard_policy_id, shard_token_name, -1)

  and {
    old_channel_live_escrow_shard_count > 0,
    old_datum.live_escrow_shard_count > 0,
    channel_datum.token == channel_token,
    channel_datum.port_id == transfer_port_id,
    channel_datum_mod.is_reclaimable(
      channel_datum,
      validator_utils.get_tx_valid_from(validity_range),
    ),
    shard_datum == TransferEscrowDatum { channel_id, denom, escrowed_amount: 0 },
    escrow_shard_value_is_canonical(
      shard_input.output,
      transfer_escrow_shard_policy_id,
      shard_token_name,
      escrowed_token_unit,
    )?,
    tokens(mint, transfer_escrow_shard_policy_id) == (
      dict.empty
        |> dict.insert(shard_token_name, -1)
    ),
    !list.any(
      outputs,
      fn(output) { output |> auth.contain_auth_token(shard_token) },
    ),
    new_datum.escrow_shard_registry_root == expected_registry_root,
    new_datum.live_escrow_shard_count == old_datum.live_escrow_shard_count - 1,
    new_datum.voucher_supply == old_datum.voucher_supply,
    module_state_output.value == expected_module_value,
  }
}

fn transfer_module_registry_transition(
  inputs: List<Input>,
  outputs: List<Output>,
  transfer_port_token: AuthToken,
) -> (Input, Output, TransferModuleDatum, TransferModuleDatum) {
  expect [module_state_input] =
    list.filter(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(transfer_port_token) },
    )
  expect [module_state_output] =
    list.filter(
      outputs,
      fn(output) { output |> auth.contain_auth_token(transfer_port_token) },
    )
  expect module_state_output.address == module_state_input.output.address

  // NoDatum is accepted only as the legacy empty root; every successor is inline.
  let old_datum =
    when module_state_input.output.datum is {
      NoDatum ->
        TransferModuleDatum {
          escrow_shard_registry_root: empty_escrow_shard_registry_root,
          live_escrow_shard_count: 0,
          voucher_supply: 0,
        }
      InlineDatum(raw) -> {
        expect decoded: TransferModuleDatum = raw
        decoded
      }
      _ -> fail @"Transfer module datum must be inline"
    }
  expect new_datum: TransferModuleDatum =
    validator_utils.get_inline_datum(module_state_output)
  expect
    bytearray.length(old_datum.escrow_shard_registry_root) == ibc_state_commitment.hash_size_bytes
  expect
    bytearray.length(new_datum.escrow_shard_registry_root) == ibc_state_commitment.hash_size_bytes

  (module_state_input, module_state_output, old_datum, new_datum)
}

fn escrow_shard_value_is_canonical(
  output: Output,
  shard_policy_id: PolicyId,
  shard_token_name: ByteArray,
  escrowed_token_unit: ByteArray,
) -> Bool {
  let (escrowed_token_policy_id, escrowed_token_name) =
    validator_utils.extract_token_unit(escrowed_token_unit)
  let escrowed_quantity =
    quantity_of(output.value, escrowed_token_policy_id, escrowed_token_name)
  let shard_nft_value = assets.from_asset(shard_policy_id, shard_token_name, 1)
  let expected_non_lovelace =
    // Canonical shards contain no unrelated non-lovelace assets.
    if escrowed_token_unit == "lovelace" {
      shard_nft_value
    } else {
      assets.merge(
        shard_nft_value,
        assets.from_asset(
          escrowed_token_policy_id,
          escrowed_token_name,
          escrowed_quantity,
        ),
      )
    }
  assets.without_lovelace(output.value) == expected_non_lovelace
}
