use aiken/crypto.{Blake2b_224, Hash, Script}

pub type MintPortRedeemer {
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  port_number: Int,
}
