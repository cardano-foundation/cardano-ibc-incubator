use aiken/crypto.{Blake2b_224, Hash, Script}

/// Field order and types are part of the redeemer ABI, so changes require a coordinated deployment.
pub type MintPortRedeemer {
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  port_id: ByteArray,
}
