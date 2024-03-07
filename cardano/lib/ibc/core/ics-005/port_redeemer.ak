use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction/credential.{Script}
use ibc/auth.{AuthToken}

pub type MintPortRedeemer {
  handler_token: AuthToken,
  spend_module_script_hash: Hash<Blake2b_224, Script>,
  port_number: Int,
}
