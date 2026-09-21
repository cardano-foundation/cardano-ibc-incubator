use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Script, VerificationKey}
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{OutputReference, Transaction}
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name, validate_finalize_shutdown,
}
use ibc/utils/validator_utils

pub fn burns_only(mint: Value, policy: PolicyId) -> Bool {
  let quantities = assets.tokens(mint, policy) |> dict.values
  !list.is_empty(quantities) && list.all(
    quantities,
    fn(quantity) { quantity < 0 },
  )
}

pub fn burns_token(transaction: Transaction, token: AuthToken) -> Bool {
  assets.quantity_of(transaction.mint, token.policy_id, token.name) == -1
}

/// Client and connection state remains necessary while a transfer escrow shard
/// is registered. The authenticated transfer root is retained as the global
/// drainage witness until those proof dependencies have been reclaimed.
pub fn transfer_is_drained(
  transaction: Transaction,
  host_policy: PolicyId,
) -> Bool {
  expect [host] =
    list.filter(
      transaction.reference_inputs,
      fn(input) {
        assets.has_nft(input.output.value, host_policy, host_state_token_name)
      },
    )
  expect host_datum: HostStateDatum =
    validator_utils.get_inline_datum(host.output)
  expect Some(registration) =
    pairs.get_first(host_datum.control.port_registry, "transfer")
  expect [root] =
    list.filter(
      transaction.reference_inputs,
      fn(input) {
        auth.contain_auth_token(input.output, registration.module_token)
      },
    )
  expect root_datum: TransferModuleDatum =
    validator_utils.get_inline_datum(root.output)
  and {
    root_datum.escrow_shard_registry_root == empty_escrow_shard_registry_root,
    root_datum.outstanding_voucher_obligation == 0,
    assets.without_lovelace(root.output.value) == assets.merge(
      assets.from_asset(
        registration.port_token.policy_id,
        registration.port_token.name,
        1,
      ),
      assets.from_asset(
        registration.module_token.policy_id,
        registration.module_token.name,
        1,
      ),
    ),
  }
}

// Cleanup transactions consume one script address at a time. Sum its inputs
// once so a single payment cannot satisfy several independent refunds.
pub fn reclaim(
  transaction: Transaction,
  own_ref: OutputReference,
  host_policy: PolicyId,
  retained_value: Value,
) -> Bool {
  let deployer = authority(transaction, host_policy)
  expect Some(own_input) = transaction.find_input(transaction.inputs, own_ref)
  expect Script(_) = own_input.output.address.payment_credential
  let reclaimed =
    list.foldl(
      transaction.inputs,
      assets.zero,
      fn(input, total) {
        when input.output.address.payment_credential is {
          Script(_) -> {
            expect input.output.address == own_input.output.address
            assets.merge(total, input.output.value)
          }
          VerificationKey(_) -> total
        }
      },
    )
  expect
    list.all(
      assets.flatten(transaction.mint),
      fn(asset) {
        let (_, _, quantity) = asset
        quantity < 0
      },
    )
  let refund =
    reclaimed
      |> assets.merge(transaction.mint)
      |> assets.merge(assets.negate(retained_value))
  let paid =
    list.foldl(
      transaction.outputs,
      assets.zero,
      fn(output, total) {
        if output.address.payment_credential == VerificationKey(deployer) {
          assets.merge(total, output.value)
        } else {
          total
        }
      },
    )
  list.all(
    assets.flatten(refund),
    fn(asset) {
      let (policy, name, quantity) = asset
      quantity >= 0 && assets.quantity_of(paid, policy, name) >= quantity
    },
  )
}

pub fn authority(
  transaction: Transaction,
  host_policy: PolicyId,
) -> VerificationKeyHash {
  expect [host] =
    list.filter(
      transaction.reference_inputs,
      fn(input) {
        assets.has_nft(input.output.value, host_policy, host_state_token_name)
      },
    )
  expect host_datum: HostStateDatum =
    validator_utils.get_inline_datum(host.output)
  expect host_datum.nft_policy == host_policy
  expect list.has(transaction.extra_signatories, host_datum.deployer)
  expect
    validate_finalize_shutdown(
      host_datum,
      validator_utils.get_tx_valid_from(transaction.validity_range),
    )
  host_datum.deployer
}

pub fn burns_script_tokens(transaction: Transaction, policy: PolicyId) -> Bool {
  let total =
    list.foldl(
      transaction.inputs,
      assets.zero,
      fn(input, value) {
        when input.output.address.payment_credential is {
          Script(_) -> assets.merge(value, input.output.value)
          _ -> value
        }
      },
    )
  list.all(
    assets.tokens(total, policy) |> dict.to_pairs,
    fn(entry) {
      let Pair(name, quantity) = entry
      assets.quantity_of(transaction.mint, policy, name) == -quantity
    },
  )
}

pub fn reclaim_policy(
  transaction: Transaction,
  policy: PolicyId,
  host_policy: PolicyId,
) -> Bool {
  expect Some(input) =
    list.find(
      transaction.inputs,
      fn(input) {
        when input.output.address.payment_credential is {
          Script(_) -> !dict.is_empty(assets.tokens(input.output.value, policy))
          _ -> False
        }
      },
    )
  and {
    burns_script_tokens(transaction, policy),
    reclaim(transaction, input.output_reference, host_policy, assets.zero),
  }
}
