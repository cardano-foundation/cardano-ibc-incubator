use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/int
use cardano/assets.{PolicyId, quantity_of, tokens}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/fungible_token_packet_data.{FungibleTokenPacketData}
use ibc/auth.{AuthToken}
use ibc/core/ics_005/port_redeemer.{
  BindPort, BurnEscrowShard, CreateEscrowShard, MintPortRedeemer,
}
use ibc/core/ics_005/types/keys as port_keys
use ibc/core/ics_025_handler_interface/handler_redeemer.{
  HandlerBindPort, HandlerOperator,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/utils/string as string_utils
use ibc/utils/validator_utils

// Introduced to prevent high spending costs or potentially prevent tx from being executed.
const max_number_of_ports = 10

// Checks the max number of ports is not exceeded
fn valid_number_of_ports(
  module_output: Output,
  port_minting_policy_id: PolicyId,
) -> Bool {
  let number_of_ports =
    module_output.value |> assets.tokens(port_minting_policy_id) |> dict.size()
  number_of_ports <= max_number_of_ports
}

validator mint_port(host_state_nft_policy_id: PolicyId) {
  mint(
    redeemer: MintPortRedeemer,
    port_minting_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, redeemers, .. } = transaction
    trace @"mint_port: extracted context data"

    let host_state_nft =
      AuthToken {
        policy_id: host_state_nft_policy_id,
        name: host_state_token_name,
      }

    when redeemer is {
      // Module setup mints ordinary transfer port auth tokens.
      BindPort { handler_token, spend_module_script_hash, port_number } ->
        validate_bind_port(
          inputs,
          outputs,
          mint,
          redeemers,
          port_minting_policy_id,
          host_state_nft,
          handler_token,
          spend_module_script_hash,
          port_number,
        )

      // First native send mints the canonical shard NFT.
      CreateEscrowShard { channel_id, denom, data } ->
        validate_create_escrow_shard(
          transaction.reference_inputs,
          outputs,
          mint,
          port_minting_policy_id,
          host_state_nft,
          channel_id,
          denom,
          data,
        )

      // Empty shard cleanup burns the canonical shard NFT.
      BurnEscrowShard { channel_id, denom } ->
        validate_burn_escrow_shard(
          inputs,
          outputs,
          mint,
          port_minting_policy_id,
          channel_id,
          denom,
        )
    }
  }

  else(_) {
    fail
  }
}

fn transfer_port_token(
  port_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
) -> AuthToken {
  let port_token_name =
    port_keys.parse_port_id_number("transfer")
      |> auth.generate_token_name(host_state_nft, port_keys.port_prefix, _)
  AuthToken { policy_id: port_minting_policy_id, name: port_token_name }
}

fn validate_bind_port(
  inputs: List<Input>,
  outputs: List<Output>,
  mint,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  port_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  handler_token: AuthToken,
  spend_module_script_hash,
  port_number: Int,
) -> Bool {
  expect Some(handler_input) =
    list.find(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(handler_token) },
    )
  // spent handler redeemer is HandlerBindPort operator
  expect Some(spent_handler_redeemer) =
    pairs.get_first(redeemers, Spend(handler_input.output_reference))
  expect handler_operator: HandlerOperator = spent_handler_redeemer
  let valid_handler_operator = handler_operator == HandlerBindPort

  // Port tokens are referenced across IBC transactions that only have access to the
  // channel auth token name. Channel auth tokens are derived from the HostState NFT.
  //
  // To make the port-token name derivable from the channel-token name, the port-token
  // name must also be derived from the same HostState NFT base.
  let port_token_name =
    string_utils.int_to_string(port_number)
      |> auth.generate_token_name(host_state_nft, port_keys.port_prefix, _)
  let port_token =
    AuthToken { policy_id: port_minting_policy_id, name: port_token_name }
  expect [module_output] =
    outputs
      |> transaction.find_script_outputs(spend_module_script_hash)

  trace @"mint_port: transfer module output datum": module_output.datum
  expect NoDatum = module_output.datum
  and {
    valid_handler_operator?,
    auth.mint_auth_token(mint, port_token)?,
    (module_output |> auth.contain_auth_token(port_token))?,
    valid_number_of_ports(module_output, port_minting_policy_id)?,
  }
}

fn validate_create_escrow_shard(
  reference_inputs: List<Input>,
  outputs: List<Output>,
  mint,
  port_minting_policy_id: PolicyId,
  host_state_nft: AuthToken,
  channel_id: ByteArray,
  denom: ByteArray,
  data: FungibleTokenPacketData,
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
    AuthToken { policy_id: port_minting_policy_id, name: shard_token_name }
  let transfer_port_token =
    transfer_port_token(port_minting_policy_id, host_state_nft)

  // The module root only anchors the canonical shard address.
  expect [module_reference_input] =
    list.filter(
      reference_inputs,
      fn(input) { input.output |> auth.contain_auth_token(transfer_port_token) },
    )

  expect [created_output] =
    list.filter(
      outputs,
      fn(output) {
        and {
          output.address == module_reference_input.output.address,
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
    // Mint exactly one shard NFT and no other port-policy tokens.
    tokens(mint, port_minting_policy_id) == (
      dict.empty
        |> dict.insert(shard_token_name, 1)
    ),
    // The datum must match the shard NFT derivation inputs.
    datum == TransferEscrowDatum { channel_id, denom },
    escrow_shard_value_is_canonical(
      created_output,
      port_minting_policy_id,
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

fn validate_burn_escrow_shard(
  inputs: List<Input>,
  outputs: List<Output>,
  mint,
  port_minting_policy_id: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
) -> Bool {
  let shard_token_name =
    transfer_escrow_shard.shard_token_name(channel_id, denom)
  let shard_token =
    AuthToken { policy_id: port_minting_policy_id, name: shard_token_name }

  // Burning requires consuming the matching shard UTxO.
  expect [_spent_shard] =
    list.filter(
      inputs,
      fn(input) { input.output |> auth.contain_auth_token(shard_token) },
    )

  and {
    // Burn exactly one shard NFT and leave no successor shard.
    tokens(mint, port_minting_policy_id) == (
      dict.empty
        |> dict.insert(shard_token_name, -1)
    ),
    list.is_empty(
      list.filter(
        outputs,
        fn(output) { output |> auth.contain_auth_token(shard_token) },
      ),
    ),
  }
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
