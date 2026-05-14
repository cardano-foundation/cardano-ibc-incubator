use aiken/builtin
use ibc/core/ics_025_handler_interface/ibc_state_commitment

test non_empty_leaf_binds_the_key_hash() {
  let value_digest = ibc_state_commitment.value_hash("same-value")

  let leaf_for_key_a =
    ibc_state_commitment.leaf_hash(builtin.sha2_256("key-a"), value_digest)

  let leaf_for_key_b =
    ibc_state_commitment.leaf_hash(builtin.sha2_256("key-b"), value_digest)

  leaf_for_key_a != leaf_for_key_b
}

test empty_leaf_remains_the_sparse_tree_default() {
  let empty_value_digest = ibc_state_commitment.value_hash("")

  ibc_state_commitment.leaf_hash(
    builtin.sha2_256("any-key"),
    empty_value_digest,
  ) == ibc_state_commitment.empty_hash
}
