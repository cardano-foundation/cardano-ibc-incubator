use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, NoDatum, Output, OutputReference, Transaction,
}
use ibc/apps/transfer/transfer_escrow_shard
use ibc/apps/transfer/types/escrow_datum.{TransferEscrowDatum}
use ibc/apps/transfer/types/transfer_module_datum.{
  TransferModuleDatum, empty_escrow_shard_registry_root,
}
use ibc/auth.{AuthToken}
use ibc/core/ics_025_handler_interface/ibc_state_commitment
use ibc/utils/shutdown
use ibc/utils/validator_utils

pub fn module_datum(output: Output) -> TransferModuleDatum {
  when output.datum is {
    NoDatum ->
      TransferModuleDatum {
        escrow_shard_registry_root: empty_escrow_shard_registry_root,
      }
    InlineDatum(raw) -> {
      expect datum: TransferModuleDatum = raw
      datum
    }
    _ -> fail
  }
}

pub fn reclaim_escrow(
  transaction: Transaction,
  own_ref: OutputReference,
  host_policy: PolicyId,
  port_token: AuthToken,
  shard_policy: PolicyId,
  channel_id: ByteArray,
  denom: ByteArray,
  registry_siblings: List<ByteArray>,
) -> Bool {
  expect [root_input] =
    list.filter(
      transaction.inputs,
      fn(input) { auth.contain_auth_token(input.output, port_token) },
    )
  expect [root_output] =
    list.filter(
      transaction.outputs,
      fn(output) { auth.contain_auth_token(output, port_token) },
    )
  expect
    list.length(
      list.filter(
        transaction.inputs,
        fn(input) {
          when input.output.address.payment_credential is {
            Script(_) -> True
            _ -> False
          }
        },
      ),
    ) == 2
  expect root_output.address == root_input.output.address
  expect
    validator_utils.preserves_state_value(
      root_input.output.value,
      root_output.value,
    )
  let shard_token =
    AuthToken {
      policy_id: shard_policy,
      name: transfer_escrow_shard.shard_token_name(channel_id, denom),
    }
  expect [shard_input] =
    list.filter(
      transaction.inputs,
      fn(input) { auth.contain_auth_token(input.output, shard_token) },
    )
  expect shard_input.output.address == root_input.output.address
  expect
    own_ref == root_input.output_reference || own_ref == shard_input.output_reference
  expect datum: TransferEscrowDatum =
    validator_utils.get_inline_datum(shard_input.output)
  expect datum == TransferEscrowDatum { channel_id, denom, escrowed_amount: 0 }
  let old_root = module_datum(root_input.output).escrow_shard_registry_root
  let new_root =
    ibc_state_commitment.apply_update(
      old_root,
      transfer_escrow_shard.shard_registry_key(channel_id, denom),
      transfer_escrow_shard.registered_shard_value,
      "",
      registry_siblings,
    )
  and {
    module_datum(root_output).escrow_shard_registry_root == new_root,
    shutdown.burns_token(transaction, shard_token),
    shutdown.reclaim(transaction, own_ref, host_policy, root_output.value),
  }
}
