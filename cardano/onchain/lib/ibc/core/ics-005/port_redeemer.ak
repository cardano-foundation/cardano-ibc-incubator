use aiken/crypto.{Blake2b_224, Hash, Script}
use ibc/auth.{AuthToken}

pub type MintPortRedeemer {
  handler_token: AuthToken,
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  port_number: Int,
}
