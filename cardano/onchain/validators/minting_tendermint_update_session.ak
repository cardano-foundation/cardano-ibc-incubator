use aiken/collection/list
use aiken/crypto.{Blake2b_224, Hash, Script}
use cardano/address.{Script as ScriptCredential}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Output, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/multitx/session
use ibc/client/ics_007_tendermint_client/multitx/types.{
  BurnSession, MintSession, MintSessionRedeemer, SessionDatum,
}
use ibc/utils/validator_utils

fn is_session_output(
  output: Output,
  session_script_hash: Hash<Blake2b_224, Script>,
  token: AuthToken,
) -> Bool {
  when output.address.payment_credential is {
    ScriptCredential(script_hash) ->
      script_hash == session_script_hash && auth.contain_auth_token(
        output,
        token,
      )
    _ -> False
  }
}

fn is_session_input(
  input: Input,
  session_script_hash: Hash<Blake2b_224, Script>,
  token: AuthToken,
) -> Bool {
  is_session_output(input.output, session_script_hash, token)
}

/// One-shot NFT policy for authenticated Tendermint update sessions.
validator mint_tendermint_update_session(
  session_script_hash: Hash<Blake2b_224, Script>,
) {
  mint(
    redeemer: MintSessionRedeemer,
    own_policy_id: PolicyId,
    transaction: Transaction,
  ) {
    let Transaction { inputs, outputs, mint, extra_signatories, .. } =
      transaction
    when redeemer is {
      MintSession { seed, owner, plan } -> {
        expect Some(_) = transaction.find_input(inputs, seed)
        expect list.has(extra_signatories, owner)
        let token =
          AuthToken {
            policy_id: own_policy_id,
            name: session.session_token_name(seed, plan),
          }
        expect [session_output] =
          list.filter(
            outputs,
            fn(output) { is_session_output(output, session_script_hash, token) },
          )
        expect output_datum: SessionDatum =
          validator_utils.get_inline_datum(session_output)
        and {
          validator_utils.require_exact_marker_mint(
            mint,
            own_policy_id,
            token.name,
            1,
          ),
          auth.contains_only_auth_tokens(session_output, [token]),
          output_datum == session.initial_datum(token, owner, plan),
        }
      }
      BurnSession { token_name } -> {
        let token = AuthToken { policy_id: own_policy_id, name: token_name }
        expect [session_input] =
          list.filter(
            inputs,
            fn(input) { is_session_input(input, session_script_hash, token) },
          )
        expect input_datum: SessionDatum =
          validator_utils.get_inline_datum(session_input.output)
        and {
          input_datum.session_token == token,
          validator_utils.require_exact_marker_mint(
            mint,
            own_policy_id,
            token_name,
            -1,
          ),
          validator_utils.no_output_contains_auth_token(outputs, token),
        }
      }
    }
  }

  else(_) {
    fail @"Tendermint update session policy can only mint or burn"
  }
}
