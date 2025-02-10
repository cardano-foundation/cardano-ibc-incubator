use aiken/primitive/bytearray
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
    1 -> and {
        bytearray.length(c.validator_address) == 0,
        c.timestamp == 0,
        bytearray.length(c.signature) == 0,
      }
    2 -> and {
        bytearray.length(c.validator_address) == address_size,
        bytearray.length(c.signature) > 0,
        bytearray.length(c.signature) <= max_signature_size,
      }
    3 -> and {
        bytearray.length(c.validator_address) == address_size,
        bytearray.length(c.signature) > 0,
        bytearray.length(c.signature) <= max_signature_size,
      }
    _n -> fail
  }
}
