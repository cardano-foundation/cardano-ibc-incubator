use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script, VerificationKey}
use cardano/assets
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/utils/shutdown
use ibc/utils/validator_utils

/// Refund both script inputs together. The legacy cleanup helper intentionally
/// accepts only one script address and cannot account for the paired cache.
pub fn validate(
  client_script: ByteArray,
  host_policy: ByteArray,
  cache_policy: ByteArray,
  policy: ByteArray,
  tx: Transaction,
) -> Bool {
  expect [Pair(name, -1)] = dict.to_pairs(assets.tokens(tx.mint, policy))
  let subject = AuthToken { policy_id: policy, name }
  let cache_token =
    AuthToken { policy_id: cache_policy, name: identity.token_name(subject) }
  expect [client] =
    list.filter(
      tx.inputs,
      fn(input) { auth.contain_auth_token(input.output, subject) },
    )
  expect client.output.address.payment_credential == Script(client_script)
  expect [cache] =
    list.filter(
      tx.inputs,
      fn(input) { auth.contain_auth_token(input.output, cache_token) },
    )
  expect datum: CacheDatum = validator_utils.get_inline_datum(cache.output)
  expect
    datum.token == cache_token && datum.client_token == subject && datum.client_address == client.output.address
  expect assets.quantity_of(tx.mint, cache_policy, cache_token.name) == -1
  expect shutdown.retires_state(tx, host_policy, 0)
  expect shutdown.transfer_is_drained(tx, host_policy)
  let deployer = shutdown.authority(tx, host_policy)
  expect
    list.all(
      tx.inputs,
      fn(input) {
        when input.output.address.payment_credential is {
          Script(_) ->
            input.output_reference == client.output_reference || input.output_reference == cache.output_reference || assets.has_nft(
              input.output.value,
              host_policy,
              host_state_token_name,
            )
          _ -> True
        }
      },
    )
  expect list.all(assets.flatten(tx.mint), fn(asset) { asset.3rd < 0 })
  let refund =
    assets.merge(client.output.value, cache.output.value)
      |> assets.merge(assets.from_asset(policy, name, -1))
      |> assets.merge(assets.from_asset(cache_policy, cache_token.name, -1))
  let paid =
    list.foldl(
      tx.outputs,
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
      asset.3rd >= 0 && assets.quantity_of(paid, asset.1st, asset.2nd) >= asset.3rd
    },
  )
}
