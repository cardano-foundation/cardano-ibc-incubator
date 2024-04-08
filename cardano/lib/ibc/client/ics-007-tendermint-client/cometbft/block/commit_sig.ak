use aiken/bytearray
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  address_size, max_signature_size,
}
use ibc/utils/time.{Time}

pub type BlockIdFlag =
  Int

pub type CommitSig {
  block_id_flag: BlockIdFlag,
  validator_address: ByteArray,
  timestamp: Time,
  signature: ByteArray,
}

// See block_id_flag constants at: lib/ibc/client/ics-007-tendermint-client/cometbft/constants.ak
pub fn validate_basic(c: CommitSig) -> Bool {
  when c.block_id_flag is {
    0 -> fail
    1 -> {
      expect bytearray.length(c.validator_address) == 0
      expect c.timestamp == 0
      expect bytearray.length(c.signature) == 0
      True
    }
    2 -> {
      expect bytearray.length(c.validator_address) == address_size
      expect bytearray.length(c.signature) > 0
      expect bytearray.length(c.signature) <= max_signature_size
      True
    }
    3 -> {
      expect bytearray.length(c.validator_address) == address_size
      expect bytearray.length(c.signature) > 0
      expect bytearray.length(c.signature) <= max_signature_size
      True
    }
    _n -> fail
  }
}
