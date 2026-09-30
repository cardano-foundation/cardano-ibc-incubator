use aiken/builtin
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/host_state.{host_state_token_name}
use ibc/utils/validator_utils

pub const config_token_name = "ibc_packet_config"

pub const registry_token_name = "ibc_packet_registry"

pub type PacketConfig {
  state_policy: PolicyId,
  batch_policy: PolicyId,
  guard_hash: ByteArray,
  lane_count: Int,
  trace_registry_hash: ByteArray,
  host_policy: PolicyId,
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

/// Deployment control is read, never spent by ordinary packet transactions.
pub fn active(transaction: Transaction, host_policy: PolicyId) -> Bool {
  expect [input] =
    list.filter(
      transaction.reference_inputs,
      fn(input) {
        assets.has_nft(input.output.value, host_policy, host_state_token_name)
      },
    )
  let raw: Data = validator_utils.get_inline_datum(input.output)
  expect Some(control) =
    list.at(builtin.snd_pair(builtin.un_constr_data(raw)), 3)
  expect Some(shutdown) =
    list.at(builtin.snd_pair(builtin.un_constr_data(control)), 1)
  shutdown == builtin.constr_data(0, [])
}
