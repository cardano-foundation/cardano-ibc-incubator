use aiken/collection/list
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/roster.{
  Datum, Initialize, Mint, Retire,
}
use ibc/client/ics_007_tendermint_client/cached/types.{CacheDatum}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/utils/validator_utils

validator mint_validator_roster(
  host_policy: ByteArray,
  roster_script: ByteArray,
  cache_policy: ByteArray,
) {
  mint(redeemer: Mint, policy: ByteArray, tx: Transaction) {
    when redeemer is {
      Initialize { client_token, orders } -> {
        expect
          assets.quantity_of(tx.mint, client_token.policy_id, client_token.name) == 1
        let client = identity.admitted_client(host_policy, client_token, tx)
        let token = AuthToken {
          policy_id: policy,
          name: identity.token_name(client_token),
        }
        expect
          validator_utils.require_exact_marker_mint(
            tx.mint,
            policy,
            token.name,
            1,
          )
        expect [output] = list.filter(
          tx.outputs,
          fn(output) { auth.contain_auth_token(output, token) },
        )
        expect
          output.address.payment_credential == Script(roster_script) && output.reference_script == None
        expect datum: Datum = validator_utils.get_inline_datum(output)
        let cache_token = AuthToken {
          policy_id: cache_policy,
          name: token.name,
        }
        expect assets.quantity_of(tx.mint, cache_policy, token.name) == 1
        expect [cache] = list.filter(
          tx.outputs,
          fn(output) { auth.contain_auth_token(output, cache_token) },
        )
        expect summary: CacheDatum = validator_utils.get_inline_datum(cache)
        expect [host] = list.filter(
          tx.inputs,
          fn(input) {
            assets.has_nft(
              input.output.value,
              host_policy,
              host_state_token_name,
            )
          },
        )
        expect host_datum: HostStateDatum = validator_utils.get_inline_datum(
          host.output,
        )
        and {
          auth.contains_only_auth_tokens(output, [token]),
          datum.token == token && datum.client_token == client_token && datum.client_address == client.address,
          datum.owner == host_datum.deployer,
          summary.token == cache_token && summary.client_token == client_token && summary.client_address == client.address,
          roster.admit(datum.records, summary.records, orders),
        }
      }
      Retire { client_token } -> {
        let token = AuthToken {
          policy_id: policy,
          name: identity.token_name(client_token),
        }
        expect [input] = list.filter(
          tx.inputs,
          fn(input) { auth.contain_auth_token(input.output, token) },
        )
        expect datum: Datum = validator_utils.get_inline_datum(input.output)
        and {
          input.output.address.payment_credential == Script(roster_script),
          datum.token == token && datum.client_token == client_token,
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
