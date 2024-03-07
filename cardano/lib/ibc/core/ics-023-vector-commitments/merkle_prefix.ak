use aiken/bytearray

pub type MerklePrefix {
  key_prefix: ByteArray,
}

pub fn bytes(mp: MerklePrefix) -> ByteArray {
  mp.key_prefix
}

pub fn empty(mp: MerklePrefix) -> Bool {
  bytearray.length(bytes(mp)) == 0
}

pub fn new_merkle_prefix(key_prefix: ByteArray) -> MerklePrefix {
  MerklePrefix { key_prefix }
}
