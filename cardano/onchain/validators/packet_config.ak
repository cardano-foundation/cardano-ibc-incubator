use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_004/packet_config.{PacketConfig, config_token_name}
use ibc/core/ics_004/packet_lanes
use ibc/utils/validator_utils

validator mint_packet_config(nonce: OutputReference) {
  mint(_redeemer: Void, policy: PolicyId, transaction: Transaction) {
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
    // The same script's spend purpose always fails, making this a permanent
    // reference. Its nonce is controlled by the initial deployment transaction.
    expect output.address.payment_credential == Script(policy)
    expect config: PacketConfig = validator_utils.get_inline_datum(output)
    packet_lanes.valid_lane_count(config.lane_count)
  }

  else(_) {
    fail
  }
}
