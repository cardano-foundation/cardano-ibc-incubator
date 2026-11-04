use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets
use cardano/transaction.{Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/client/ics_007_tendermint_client/cached/identity
use ibc/client/ics_007_tendermint_client/cached/roster
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set
use ibc/client/ics_007_tendermint_client/consensus_history
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/utils/forwarding
use ibc/utils/tx_time.{TxTime}
use ibc/utils/validator_utils

pub fn payload(raw: Data) -> roster.Hit {
  expect Pair(7, [hit]) = builtin.un_constr_data(raw)
  expect hit: roster.Hit = hit
  hit
}

/// The guard pins only the identity. The small withdrawal verifier decodes and
/// checks the complete witness once, as on the current cache path.
pub fn token(raw: Data) -> AuthToken {
  expect Pair(7, [hit]) = builtin.un_constr_data(raw)
  expect Pair(0, [token, _, _, _, _, _]) = builtin.un_constr_data(hit)
  expect token: AuthToken = token
  token
}

pub fn validate(
  host_policy: ByteArray,
  subject: AuthToken,
  credential: Credential,
  tx: Transaction,
) -> Bool {
  let expected: Data = subject
  expect forwarding.require_zero(credential, expected, tx)
  expect [client] = list.filter(
    tx.inputs,
    fn(input) { auth.contain_auth_token(input.output, subject) },
  )
  expect datum: ClientDatum = validator_utils.get_inline_datum(client.output)
  expect datum.token == subject
  expect Some(raw) = pairs.get_first(
    tx.redeemers,
    Spend(client.output_reference),
  )
  let hit = payload(raw)
  expect hit.roster_token.name == identity.token_name(subject)
  expect [reference] = list.filter(
    tx.reference_inputs,
    fn(input) { auth.contain_auth_token(input.output, hit.roster_token) },
  )
  expect reference.output.reference_script == None
  expect roster: roster.Datum = validator_utils.get_inline_datum(
    reference.output,
  )
  expect
    roster.token == hit.roster_token && roster.client_token == subject && roster.client_address == client.output.address
  expect tx.mint |> assets.tokens(hit.roster_token.policy_id) |> dict.is_empty
  expect tx.mint |> assets.tokens(subject.policy_id) |> dict.is_empty
  let output = validator_utils.find_unique_continuation_output(
    client.output,
    tx.outputs,
    subject,
  )
  expect next: ClientDatum = validator_utils.get_inline_datum(output)
  expect _ = validator_utils.require_host_state_redeemer(
    tx.inputs,
    tx.outputs,
    tx.redeemers,
    host_policy,
    validator_utils.ExpectUpdateClient,
  )
  let valid_to = validator_utils.get_tx_valid_to(tx.validity_range)
  expect
    roster.header(
      datum,
      TxTime {
        valid_from: validator_utils.get_tx_valid_from(tx.validity_range) * 1_000_000,
        valid_to: valid_to * 1_000_000,
      },
      roster.records,
      hit,
    )
  let header = Header {
    signed_header: hit.signed_header,
    validator_set: validator_set.null_validator_set(),
    trusted_height: hit.trusted_height,
    trusted_validators: validator_set.null_validator_set(),
  }
  and {
    client_datum.update_state(datum, next, header, valid_to),
    consensus_history.insert(
      datum.history_root,
      consensus_history.from_client(datum),
      hit.history_siblings,
    ) == next.history_root,
  }
}
