use aiken/collection/list
use aiken/collection/pairs
use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/transaction.{Spend, Transaction}
use ibc/auth
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatum}
use ibc/client/ics_007_tendermint_client/client_datum as client_datum_mod
use ibc/client/ics_007_tendermint_client/client_redeemer.{
  RecoverClient, RecoverClientWithdrawal, RecoverClientWithdrawalRedeemer,
  SpendClientRedeemer,
}
use ibc/client/ics_007_tendermint_client/client_state as client_state_mod
use ibc/core/ics_002_client_semantics/types/client.{Active}
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/utils/validator_utils

validator recover_client(host_state_nft_policy_id: PolicyId) {
  withdraw(
    redeemer: RecoverClientWithdrawalRedeemer,
    _credential: Credential,
    transaction: Transaction,
  ) {
    let Transaction {
      inputs,
      reference_inputs,
      outputs,
      extra_signatories,
      validity_range,
      redeemers,
      ..
    } = transaction

    // Recovery is an explicit administrative operation. The unique HostState
    // identifies the authority for this deployment.
    expect [host_input] =
      list.filter(
        inputs,
        fn(input) {
          assets.has_nft(
            input.output.value,
            host_state_nft_policy_id,
            host_state_token_name,
          )
        },
      )
    expect host_state_datum: HostStateDatum =
      validator_utils.get_inline_datum(host_input.output)
    expect host_state_datum.nft_policy == host_state_nft_policy_id
    expect list.has(extra_signatories, host_state_datum.deployer)

    let RecoverClientWithdrawal { subject_token, substitute_token } = redeemer
    expect subject_token != substitute_token
    expect subject_token.policy_id == substitute_token.policy_id

    expect [subject_input] =
      list.filter(
        inputs,
        fn(input) { auth.contain_auth_token(input.output, subject_token) },
      )
    expect subject_datum: ClientDatum =
      validator_utils.get_inline_datum(subject_input.output)
    expect subject_datum.token == subject_token

    // The client spend must name the same substitute as the withdrawal.
    expect Some(subject_spend_redeemer) =
      pairs.get_first(redeemers, Spend(subject_input.output_reference))
    expect RecoverClient { substitute_token: spend_substitute_token }: SpendClientRedeemer =
      subject_spend_redeemer
    expect spend_substitute_token == substitute_token

    expect [substitute_input] =
      list.filter(
        reference_inputs,
        fn(input) { auth.contain_auth_token(input.output, substitute_token) },
      )
    expect substitute_input.output.address == subject_input.output.address
    expect substitute_datum: ClientDatum =
      validator_utils.get_inline_datum(substitute_input.output)
    expect substitute_datum.token == substitute_token
    expect
      auth.contains_only_auth_tokens(
        substitute_input.output,
        [substitute_token],
      )

    let subject_output =
      validator_utils.find_unique_continuation_output(
        subject_input.output,
        outputs,
        subject_token,
      )
    expect auth.contains_only_auth_tokens(subject_output, [subject_token])
    expect recovered_datum: ClientDatum =
      validator_utils.get_inline_datum(subject_output)

    let valid_to = validator_utils.get_tx_valid_to(validity_range) * 1_000_000
    expect
      client_state_mod.status(
        subject_datum.state.client_state,
        valid_to,
        subject_datum.state.consensus_states,
      ) != Active
    expect
      client_state_mod.status(
        substitute_datum.state.client_state,
        valid_to,
        substitute_datum.state.consensus_states,
      ) == Active

    client_datum_mod.recover_state(
      subject_datum,
      substitute_datum,
      recovered_datum,
    )
  }

  else(_) {
    fail
  }
}
