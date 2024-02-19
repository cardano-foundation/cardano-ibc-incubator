pub type MerkleRoot {
  hash: ByteArray,
}

/// new_merkle_root constructs a new MerkleRoot
pub fn new_merkle_root(hash: ByteArray) -> MerkleRoot {
  MerkleRoot { hash }
}
