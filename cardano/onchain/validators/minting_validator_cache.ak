use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  CacheDatum, InitializeCache, MintCache, RetireCache,
}
use ibc/utils/validator_utils

validator mint_validator_cache(host_policy: PolicyId, cache_script: ByteArray) {
  mint(redeemer: MintCache, policy: PolicyId, tx: Transaction) {
    when redeemer is {
      InitializeCache { client_token, leaves, additional_set } -> {
        // The canonical client policy creates each identity exactly once. Coupling
        // admission to that mint gives the client one cache, rather than a growing
        // collection of independently minted cache objects.
        expect
          assets.quantity_of(tx.mint, client_token.policy_id, client_token.name) == 1
        let client = identity.admitted_client(host_policy, client_token, tx)
        expect Script(_) = client.address.payment_credential
        let token =
          AuthToken {
            policy_id: policy,
            name: identity.token_name(client_token),
          }
        expect [output] =
          list.filter(
            tx.outputs,
            fn(output) { auth.contain_auth_token(output, token) },
          )
        expect output.address.payment_credential == Script(cache_script)
        expect datum: CacheDatum = validator_utils.get_inline_datum(output)
        let first = proof.full(leaves)
        let records =
          if additional_set == [] {
            [first]
          } else {
            let second = proof.full(additional_set)
            expect first.root != second.root
            [first, second]
          }
        and {
          validator_utils.require_exact_marker_mint(
            tx.mint,
            policy,
            token.name,
            1,
          ),
          auth.contains_only_auth_tokens(output, [token]),
          datum == CacheDatum {
            token,
            client_token,
            client_address: client.address,
            records,
          },
        }
      }
      RetireCache { client_token } -> {
        let token =
          AuthToken {
            policy_id: policy,
            name: identity.token_name(client_token),
          }
        expect [input] =
          list.filter(
            tx.inputs,
            fn(input) { auth.contain_auth_token(input.output, token) },
          )
        expect datum: CacheDatum =
          validator_utils.get_inline_datum(input.output)
        and {
          input.output.address.payment_credential == Script(cache_script),
          datum.token == token && datum.client_token == client_token,
          assets.quantity_of(tx.mint, client_token.policy_id, client_token.name) == -1,
          validator_utils.require_exact_marker_mint(
            tx.mint,
            policy,
            token.name,
            -1,
          ),
          validator_utils.no_output_contains_auth_token(tx.outputs, token),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
