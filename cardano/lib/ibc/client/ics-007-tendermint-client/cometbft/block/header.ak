use aiken/bytearray
use aiken/hash.{Hash, Sha3_256}
use ibc/client/ics_007_tendermint_client/cometbft/constants.{
  max_chain_id_len, tm_hash_size,
}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}

pub type TmHeader {
  chain_id: ByteArray,
  height: Int,
  time: Int,
  validators_hash: Hash<Sha3_256, ValidatorSet>,
  next_validators_hash: Hash<Sha3_256, ValidatorSet>,
  app_hash: ByteArray,
}

pub fn validate_basic(header: TmHeader) -> Bool {
  expect bytearray.length(header.chain_id) <= max_chain_id_len

  expect header.height > 0

  expect validate_hash(header.next_validators_hash)

  expect header.time > 0

  True
}

fn validate_hash(h: ByteArray) -> Bool {
  let len = h |> bytearray.length()
  len == 0 || len == tm_hash_size
}
