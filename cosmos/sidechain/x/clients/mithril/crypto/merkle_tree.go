package crypto

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"hash"

	"golang.org/x/crypto/blake2b"
)

// / The values that are committed in the Merkle Tree.
// / Namely, a verified `VerificationKey` and its corresponding stake.
type MTLeaf struct {
	*VerificationKey
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

// Equal checks if two MerkleTreeCommitmentBatchCompat instances are equal.
func (mtc *MerkleTreeCommitmentBatchCompat) Equal(other *MerkleTreeCommitmentBatchCompat) bool {
	return bytes.Equal(mtc.Root, other.Root) && mtc.NrLeaves == other.NrLeaves
}

// FromBytes deserializes bytes into an MTLeaf instance.
func (leaf *MTLeaf) FromBytes(bytes []byte) (*MTLeaf, error) {
	if len(bytes) != 104 {
		return nil, fmt.Errorf("mtleaf from invalid bytes length")
	}

	pk, err := new(StmVerificationKey).FromBytes(bytes[:96])
	if err != nil {
		return nil, fmt.Errorf("merkle tree serialization error")
	}

	var u64Bytes [8]byte
	copy(u64Bytes[:], bytes[96:])
	stake := binary.BigEndian.Uint64(u64Bytes[:])

	leaf.VerificationKey = pk
	leaf.Stake = Stake(stake)
	return leaf, nil
}

// ToBytes serializes an MTLeaf instance into bytes.
func (leaf *MTLeaf) ToBytes() []byte {
	var result [104]byte
	copy(result[:96], leaf.VerificationKey.ToBytes())

	var bytes [8]byte
	binary.BigEndian.PutUint64(bytes[:], uint64(leaf.Stake))
	copy(result[96:], bytes[:])
	return result[:]
}

// From converts an MTLeaf instance into a tuple of StmVerificationKey and Stake.
func (leaf *MTLeaf) From() (*VerificationKey, Stake) {
	return leaf.VerificationKey, leaf.Stake
}

// CompareStake compares the stake values of two MTLeaf instances.
func (leaf *MTLeaf) CompareStake(other *MTLeaf) int {
	if leaf.Stake < other.Stake {
		return -1
	} else if leaf.Stake > other.Stake {
		return 1
	}
	return 0
}

// CompareKey compares the verification keys of two MTLeaf instances.
func (leaf *MTLeaf) CompareKey(other *MTLeaf) int {
	return bytes.Compare(leaf.VerificationKey.ToBytes(), other.VerificationKey.ToBytes())
}

// PartialCmp compares two MTLeaf instances and returns an integer comparison result.
func (leaf *MTLeaf) Cmp(other *MTLeaf) int {
	stakeComparison := leaf.CompareStake(other)
	if stakeComparison != 0 {
		return stakeComparison
	}
	return leaf.CompareKey(other)
}

// Cmp compares two MTLeaf instances and returns an integer comparison result.
func (leaf *MTLeaf) PartialCmp(other *MTLeaf) int {
	return leaf.Cmp(other)
}

// ToBytes converts the Path instance to a byte slice.
func (p *Path) ToBytes() []byte {
	output := make([]byte, 0)
	indexBytes := make([]byte, 8)
	lenBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(indexBytes, uint64(p.Index))
	binary.BigEndian.PutUint64(lenBytes, uint64(len(p.Values)))
	output = append(output, indexBytes...)
	output = append(output, lenBytes...)
	for _, valueList := range p.Values {
		for _, value := range valueList {
			output = append(output, value...)
		}
	}
	return output
}

// FromBytes extracts a Path instance from a byte slice.
func (p *Path) FromBytes(bytes []byte) (*Path, error) {
	if len(bytes) < 16 {
		return nil, fmt.Errorf("path from invalid bytes length %v", len(bytes))
	}

	index := binary.BigEndian.Uint64(bytes[:8])
	length := binary.BigEndian.Uint64(bytes[8:16])
	values := make([][][]byte, length)
	offset := 16
	hashSize := blake2b.Size256

	for i := uint64(0); i < length; i++ {
		valueList := make([][]byte, 0)
		for j := 0; j < int(length); j++ { // Assuming fixed number of elements in each valueList
			start := offset + int(i*uint64(hashSize))
			end := start + hashSize
			if end > len(bytes) {
				return nil, fmt.Errorf("path deserialization error")
			}
			valueList = append(valueList, bytes[start:end])
		}
		values[i] = valueList
	}

	hasher, err := blake2b.New256(nil)
	if err != nil {
		return nil, fmt.Errorf("path hasher initialization error %v", err)
	}

	p.Values = values
	p.Index = index
	p.Hasher = hasher

	return p, nil
}

// ToBytes converts the BatchPath instance to a byte slice.
func (bp *BatchPath) ToBytes() []byte {
	output := make([]byte, 0)
	lenV := uint64(len(bp.Values))
	lenI := uint64(len(bp.Indices))

	lenVBytes := make([]byte, 8)
	lenIBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(lenVBytes, lenV)
	binary.BigEndian.PutUint64(lenIBytes, lenI)
	output = append(output, lenVBytes...)
	output = append(output, lenIBytes...)

	for _, valueList := range bp.Values {
		for _, value := range valueList {
			output = append(output, value...)
		}
	}

	for _, index := range bp.Indices {
		indexBytes := make([]byte, 8)
		binary.BigEndian.PutUint64(indexBytes, index)
		output = append(output, indexBytes...)
	}
	return output
}

// FromBytes extracts a BatchPath instance from a byte slice.
func (bp *BatchPath) FromBytes(bytes []byte) (*BatchPath, error) {
	if len(bytes) < 16 {
		return nil, errors.New("serialization error")
	}

	lenV := binary.BigEndian.Uint64(bytes[:8])
	lenI := binary.BigEndian.Uint64(bytes[8:16])

	values := make([][][]byte, lenV)
	offset := 16
	hashSize := blake2b.Size256

	for i := uint64(0); i < lenV; i++ {
		valueList := make([][]byte, 0)
		for j := 0; j < int(lenV); j++ { // Assuming fixed number of elements in each valueList
			start := offset + int(i*uint64(hashSize))
			end := start + hashSize
			if end > len(bytes) {
				return nil, fmt.Errorf("deserialization error")
			}
			valueList = append(valueList, bytes[start:end])
		}
		values[i] = valueList
	}
	offset += int(lenV) * hashSize

	indices := make([]uint64, lenI)
	for i := uint64(0); i < lenI; i++ {
		start := offset + int(i*8)
		end := start + 8
		if end > len(bytes) {
			return nil, fmt.Errorf("serialization error")
		}
		indices[i] = binary.BigEndian.Uint64(bytes[start:end])
	}

	hasher, err := blake2b.New256(nil)
	if err != nil {
		return nil, fmt.Errorf("path hasher initialization error %v", err)
	}

	bp.Values = values
	bp.Indices = indices
	bp.Hasher = hasher

	return bp, nil
}
