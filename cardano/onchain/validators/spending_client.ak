use aiken/builtin
use aiken/collection/list
use aiken/collection/pairs
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, OutputReference, Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  DirectUpdateDisabled, SpendClientRedeemer, UpdateClientProof,
}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/utils/validator_utils

fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      assets.has_nft(input.output.value, nft_policy, host_state_token_name)
    },
  )
}

validator spend_client(
  host_state_nft_policy_id: PolicyId,
  proof_validator_hash: ScriptHash,
) {
  spend(
    datum: Option<ClientDatum>,
    redeemer: SpendClientRedeemer,
    spent_output_ref: OutputReference,
    transaction: Transaction,
  ) {
    let Transaction { outputs, inputs, withdrawals, redeemers, .. } =
      transaction

    // Any client state update must be committed into the HostState root in the
    // same transaction, using the HostState branch that commits client keys.
    expect Some(host_input) =
      find_host_state_input(inputs, host_state_nft_policy_id)
    expect Some(spent_host_state_redeemer) =
      pairs.get_first(redeemers, Spend(host_input.output_reference))
    // HostStateRedeemer.UpdateClient is constructor 4 with exactly three
    // witness fields. HostState itself decodes and validates those witnesses.
    let Pair(host_redeemer_tag, host_redeemer_fields) =
      builtin.un_constr_data(spent_host_state_redeemer)
    expect host_redeemer_tag == 4
    expect [_, _, _] = host_redeemer_fields

    expect Some(spent_input) = transaction.find_input(inputs, spent_output_ref)
    let spent_output = spent_input.output

    //========================valid input=======================
    expect Some(datum) = datum

    //========================valid output=======================
    // This also requires the input to contain the client token.
    let updated_output =
      validator_utils.find_unique_continuation_output(
        spent_output,
        outputs,
        datum.token,
      )

    // output contains client token
    expect auth.contains_only_auth_tokens(updated_output, [datum.token])

    // The withdrawal validator checks the exact state transition; this script
    // still requires the unique continuation datum to decode as a client.
    expect _updated_datum: ClientDatum =
      validator_utils.get_inline_datum(updated_output)
    when redeemer is {
      DirectUpdateDisabled -> False
      UpdateClientProof ->
        pairs.get_first(withdrawals, Script(proof_validator_hash)) == Some(0)
    }
  }

  else(_) {
    fail
  }
}
