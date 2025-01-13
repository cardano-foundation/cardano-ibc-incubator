use aiken/crypto.{Hash, Sha3_256}
use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

pub type ConsensusState {
  timestamp: Int,
  next_validators_hash: Hash<Sha3_256, ByteArray>,
  root: MerkleRoot,
}

/// get_root returns the commitment Root for the specific
pub fn get_root(cs: ConsensusState) -> MerkleRoot {
  cs.root
}

/// get_timestamp returns block time in nanoseconds of the header that created consensus state
pub fn get_timestamp(cs: ConsensusState) -> Int {
  cs.timestamp
}

pub fn null_consensus_state() -> ConsensusState {
  ConsensusState {
    timestamp: 0,
    next_validators_hash: #"",
    root: MerkleRoot { hash: #"" },
  }
}
