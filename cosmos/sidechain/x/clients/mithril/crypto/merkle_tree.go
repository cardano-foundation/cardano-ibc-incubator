package crypto

import "hash"

// / The values that are committed in the Merkle Tree.
// / Namely, a verified `VerificationKey` and its corresponding stake.
type MTLeaf struct {
	VerificationKey
	Stake
}

// / Path of hashes from root to leaf in a Merkle Tree.
// / Contains all hashes on the path, and the index of the leaf.
// / Used to verify that signatures come from eligible signers.
type Path struct {
	Values [][][]byte
	Index  uint64
	Hasher hash.Hash
}

// / Path of hashes for a batch of indices.
// / Contains the hashes and the corresponding merkle tree indices of given batch.
// / Used to verify the signatures are issued by the registered signers.
type BatchPath struct {
	Values  [][][]byte
	Indices []uint64
	Hasher  hash.Hash
}

// / `MerkleTree` commitment.
// / This structure differs from `MerkleTree` in that it does not contain all elements, which are not always necessary.
// / Instead, it only contains the root of the tree.
type MerkleTreeCommitment struct {
	/// Root of the merkle commitment.
	Root   []byte
	Hasher hash.Hash
}

// / Batch compatible `MerkleTree` commitment .
// / This structure differs from `MerkleTreeCommitment` in that it stores the number of leaves in the tree
// / as well as the root of the tree.
// / Number of leaves is required by the batch path generation/verification.
type MerkleTreeCommitmentBatchCompat struct {
	/// Root of the merkle commitment.
	Root     []byte
	NrLeaves uint64
	Hasher   hash.Hash
}

// / Tree of hashes, providing a commitment of data and its ordering.
type MerkleTree struct {
	/// The nodes are stored in an array heap:
	/// * `nodes[0]` is the root,
	/// * the parent of `nodes[i]` is `nodes[(i-1)/2]`
	/// * the children of `nodes[i]` are `{nodes[2i + 1], nodes[2i + 2]}`
	/// * All nodes have size `Output<D>::output_size()`, even leafs (which are hashed before committing them).
	Nodes [][][]byte
	/// The leaves begin at `nodes[leaf_off]`.
	LeafOff uint64
	/// Number of leaves cached in the merkle tree.
	N uint64
	/// Phantom type to link the tree with its hasher
	Hasher hash.Hash
}
