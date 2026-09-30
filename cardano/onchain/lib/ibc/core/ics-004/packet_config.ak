use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/utils/validator_utils

pub const config_token_name = "ibc_packet_config"

pub const registry_token_name = "ibc_packet_registry"

pub type PacketConfig {
  state_policy: PolicyId,
  batch_policy: PolicyId,
  guard_hash: ByteArray,
  lane_count: Int,
  trace_registry_hash: ByteArray,
}

pub type PacketRegistry {
  next_channel: Int,
}

pub fn reference(
  transaction: Transaction,
  config_token: AuthToken,
) -> PacketConfig {
  expect [input] =
    list.filter(
      transaction.reference_inputs,
      fn(input) { auth.contain_auth_token(input.output, config_token) },
    )
  expect config: PacketConfig = validator_utils.get_inline_datum(input.output)
  config
}
