use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate}
use cardano/transaction.{Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/types.{
  CacheDatum, CachedClientRedeemer, CachedUpdate,
}
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/utils/forwarding
use ibc/utils/tx_time.{TxTime}
use ibc/utils/validator_utils

validator update_cached_client(
  host_policy: PolicyId,
  cache_policy: PolicyId,
  administrative_script: ByteArray,
) {
  withdraw(subject: AuthToken, credential: Credential, tx: Transaction) {
    let raw: Data = subject
    expect forwarding.require_zero(credential, raw, tx)
    expect [client] =
      list.filter(
        tx.inputs,
        fn(input) { auth.contain_auth_token(input.output, subject) },
      )
    expect datum: ClientDatum = validator_utils.get_inline_datum(client.output)
    expect datum.token == subject
    expect Some(raw_spend) =
      pairs.get_first(tx.redeemers, Spend(client.output_reference))
    expect CachedUpdate { update }: CachedClientRedeemer = raw_spend
    expect update.cache_token.policy_id == cache_policy
    expect [cache_input] =
      list.filter(
        tx.inputs,
        fn(input) { auth.contain_auth_token(input.output, update.cache_token) },
      )
    expect cache: CacheDatum =
      validator_utils.get_inline_datum(cache_input.output)
    expect
      cache.token == update.cache_token && cache.client_token == subject && cache.client_address == client.output.address
    expect tx.mint |> assets.tokens(cache_policy) |> dict.is_empty
    expect tx.mint |> assets.tokens(subject.policy_id) |> dict.is_empty
    let cache_output =
      validator_utils.find_unique_continuation_output(
        cache_input.output,
        tx.outputs,
        cache.token,
      )
    expect next_cache: CacheDatum =
      validator_utils.get_inline_datum(cache_output)
    let output =
      validator_utils.find_unique_continuation_output(
        client.output,
        tx.outputs,
        subject,
      )
    expect next: ClientDatum = validator_utils.get_inline_datum(output)
    expect _ =
      validator_utils.require_host_state_redeemer(
        tx.inputs,
        tx.outputs,
        tx.redeemers,
        host_policy,
        validator_utils.ExpectUpdateClient,
      )
    let valid_to = validator_utils.get_tx_valid_to(tx.validity_range)
    let time =
      TxTime {
        valid_from: validator_utils.get_tx_valid_from(tx.validity_range) * 1_000_000,
        valid_to: valid_to * 1_000_000,
      }
    let records = verify.apply_sets(cache.records, update.sets)
    let next_records = verify.header(datum, time, records, update)
    let header =
      Header {
        signed_header: update.signed_header,
        validator_set: validator_set.null_validator_set(),
        trusted_height: update.trusted_height,
        trusted_validators: validator_set.null_validator_set(),
      }
    and {
      next_cache == CacheDatum { ..cache, records: next_records },
      client_datum.update_state(datum, next, header, valid_to),
      consensus_history.insert(
        datum.history_root,
        consensus_history.from_client(datum),
        update.history_siblings,
      ) == next.history_root,
    }
  }

  publish(_redeemer: Void, certificate: Certificate, tx: Transaction) {
    forwarding.deregister_with(administrative_script, certificate, tx)
  }

  else(_) {
    fail
  }
}
