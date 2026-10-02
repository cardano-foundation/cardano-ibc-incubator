use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config.{PacketConfig, config_token_name}
use ibc/core/ics_004/packet_lanes
use ibc/core/ics_025_handler_interface/host_state.{
  HostStateDatum, host_state_token_name,
}
use ibc/utils/shutdown
use ibc/utils/validator_utils

validator mint_packet_config(nonce: OutputReference, host_policy: PolicyId) {
  mint(_redeemer: Void, policy: PolicyId, transaction: Transaction) {
    if assets.tokens(transaction.mint, policy) == dict.singleton(
      config_token_name,
      -1,
    ) {
      expect [host] =
        list.filter(
          transaction.reference_inputs,
          fn(input) {
            assets.has_nft(
              input.output.value,
              host_policy,
              host_state_token_name,
            )
          },
        )
      expect datum: HostStateDatum =
        validator_utils.get_inline_datum(host.output)
      expect datum.control.live_channels == 0
      // Configuration reserves belong to the deploying key, which authorizes
      // their return or use for cleanup fees.
      shutdown.authority(transaction, host_policy) == datum.deployer
    } else {
      expect Some(_) = transaction.find_input(transaction.inputs, nonce)
      expect
        assets.tokens(transaction.mint, policy) == dict.singleton(
          config_token_name,
          1,
        )
      expect [output] =
        list.filter(
          transaction.outputs,
          fn(output) {
            auth.contain_auth_token(
              output,
              AuthToken { policy_id: policy, name: config_token_name },
            )
          },
        )
      // The nonce authenticates deployment. Only drained shutdown can retire it.
      expect output.address.payment_credential == Script(policy)
      expect config: PacketConfig = validator_utils.get_inline_datum(output)
      config.host_policy == host_policy && packet_lanes.valid_lane_count(
        config.lane_count,
      )
    }
  }

  spend(
    _datum: Option<Data>,
    _redeemer: Void,
    ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(input) = transaction.find_input(transaction.inputs, ref)
    expect Script(policy) = input.output.address.payment_credential
    shutdown.burns_token(
      transaction,
      AuthToken { policy_id: policy, name: config_token_name },
    )
  }

  else(_) {
    fail
  }
}
