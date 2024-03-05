use ibc/utils/time.{Time}

pub type BlockIdFlag =
  Int

pub type CommitSig {
  block_id_flag: BlockIdFlag,
  validator_address: ByteArray,
  timestamp: Time,
  signature: ByteArray,
}

pub fn validate_basic(_c: CommitSig) -> Bool {
  True
}
