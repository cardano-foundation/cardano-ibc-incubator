package crypto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"hash"
	"sort"

	"golang.org/x/crypto/blake2b"
)

// The values that are committed in the Merkle Tree.
// Namely, a verified `VerificationKey` and its corresponding stake.
type MTLeaf struct {
	*VerificationKey
	Stake
}

// Path of hashes from root to leaf in a Merkle Tree.
// Contains all hashes on the path, and the index of the leaf.
// Used to verify that signatures come from eligible signers.
type Path struct {
	Values [][]byte
	Index  uint64
	Hasher hash.Hash
}

// Path of hashes for a batch of indices.
// Contains the hashes and the corresponding merkle tree indices of given batch.
// Used to verify the signatures are issued by the registered signers.
type BatchPath struct {
	Values  [][]byte
	Indices []uint64
	Hasher  hash.Hash
}

// `MerkleTree` commitment.
// This structure differs from `MerkleTree` in that it does not contain all elements, which are not always necessary.
// Instead, it only contains the root of the tree.
type MerkleTreeCommitment struct {
	/// Root of the merkle commitment.
	Root   []byte
	Hasher hash.Hash
}

// Batch compatible `MerkleTree` commitment .
// This structure differs from `MerkleTreeCommitment` in that it stores the number of leaves in the tree
// as well as the root of the tree.
// Number of leaves is required by the batch path generation/verification.
type MerkleTreeCommitmentBatchCompat struct {
	/// Root of the merkle commitment.
	Root     []byte
	NrLeaves uint64
	Hasher   hash.Hash
}

// Tree of hashes, providing a commitment of data and its ordering.
type MerkleTree struct {
	/// The nodes are stored in an array heap:
	/// * `nodes[0]` is the root,
	/// * the parent of `nodes[i]` is `nodes[(i-1)/2]`
	/// * the children of `nodes[i]` are `{nodes[2i + 1], nodes[2i + 2]}`
	/// * All nodes have size `Output<D>::output_size()`, even leafs (which are hashed before committing them).
	Nodes [][]byte
	/// The leaves begin at `nodes[leaf_off]`.
	LeafOff uint64
	/// Number of leaves cached in the merkle tree.
	N uint64
	/// Phantom type to link the tree with its hasher
	Hasher hash.Hash
}

// ====================== MTLeaf implementation ======================
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

// ====================== Path implementation ======================
// ToBytes converts the Path instance to a byte slice.
func (p *Path) ToBytes() []byte {
	output := make([]byte, 0)
	indexBytes := make([]byte, 8)
	lenBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(indexBytes, uint64(p.Index))
	binary.BigEndian.PutUint64(lenBytes, uint64(len(p.Values)))
	output = append(output, indexBytes...)
	output = append(output, lenBytes...)
	for _, value := range p.Values {
		output = append(output, value...)
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
	values := make([][]byte, length)
	offset := 16
	hashSize := blake2b.Size256

	for i := uint64(0); i < length; i++ {
		start := offset + int(i*uint64(hashSize))
		end := start + hashSize
		if end > len(bytes) {
			return nil, fmt.Errorf("path deserialization error")
		}
		values = append(values, bytes[start:end])
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

// ====================== BatchPath implementation ======================
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

	for _, value := range bp.Values {
		output = append(output, value...)
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
		return nil, fmt.Errorf("serialization error")
	}

	lenV := binary.BigEndian.Uint64(bytes[:8])
	lenI := binary.BigEndian.Uint64(bytes[8:16])

	values := make([][]byte, lenV)
	offset := 16
	hashSize := blake2b.Size256

	for i := uint64(0); i < lenV; i++ {
		start := offset + int(i*uint64(hashSize))
		end := start + hashSize
		if end > len(bytes) {
			return nil, fmt.Errorf("deserialization error")
		}
		values = append(values, bytes[start:end])
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

// ====================== MerkleTreeCommitment implementation ======================
// Check an inclusion proof that `val` is part of the tree by traveling the whole path until the root.
// # Error
// If the merkle tree path is invalid, then the function fails.
func (mtc *MerkleTreeCommitment) Check(val *MTLeaf, proof *Path) error {
	idx := proof.Index
	mtc.Hasher.Reset()
	mtc.Hasher.Write(val.ToBytes()) // assuming MTLeaf has a toBytes() method or similar functionality
	h := mtc.Hasher.Sum(nil)

	for _, p := range proof.Values {
		mtc.Hasher.Reset()
		if idx&1 == 0 {
			mtc.Hasher.Write(h)
			mtc.Hasher.Write(p)
		} else {
			mtc.Hasher.Write(p)
			mtc.Hasher.Write(h)
		}
		h = mtc.Hasher.Sum(nil)
		idx >>= 1
	}

	if bytes.Equal(h, mtc.Root) {
		return nil
	}
	return fmt.Errorf("invalid merkle tree path")
}

// Serializes the Merkle Tree commitment together with a message in a single vector of bytes.
// Outputs `msg || self` as a vector of bytes.
func (mtc *MerkleTreeCommitment) ConcatWithMsg(msg []byte) []byte {
	msgp := append([]byte{}, msg...)
	bytes := append([]byte{}, mtc.Root...)
	return append(msgp, bytes...)
}

// ====================== MerkleTreeCommitmentBatchCompat implementation ======================
// Equal checks if two MerkleTreeCommitmentBatchCompat instances are equal.
func (mtc *MerkleTreeCommitmentBatchCompat) Equal(other *MerkleTreeCommitmentBatchCompat) bool {
	return bytes.Equal(mtc.Root, other.Root) && mtc.NrLeaves == other.NrLeaves
}

// Serializes the Merkle Tree commitment together with a message in a single vector of bytes.
// Outputs `msg || self` as a vector of bytes.
// todo: Do we need to concat msg to whole commitment (nr_leaves and root) or just the root?
func (m *MerkleTreeCommitmentBatchCompat) ConcatWithMsg(msg []byte) []byte {
	var result []byte
	result = append(result, msg...)
	result = append(result, m.Root...)
	return result
}

// Check a proof of a batched opening. The indices must be ordered.
//
// # Error
// Returns an error if the proof is invalid.
// todo: Update doc.
// todo: Simplify the algorithm.
// todo: Maybe we want more granular errors, rather than only `BatchPathInvalid`
func (m *MerkleTreeCommitmentBatchCompat) Check(batchVal []*MTLeaf, proof *BatchPath) error {
	if len(batchVal) != len(proof.Indices) {
		return fmt.Errorf("batch value length does not match proof indices length")
	}

	orderedIndices := make([]uint64, len(proof.Indices))
	copy(orderedIndices, proof.Indices)
	sort.Slice(orderedIndices, func(i, j int) bool { return orderedIndices[i] < orderedIndices[j] })

	if !bytes.Equal(toByteSlice(orderedIndices), toByteSlice(proof.Indices)) {
		return fmt.Errorf("proof indices are not ordered")
	}

	nrNodes := m.NrLeaves + nextPowerOfTwo(m.NrLeaves) - 1
	for i, index := range orderedIndices {
		orderedIndices[i] = index + nextPowerOfTwo(m.NrLeaves) - 1
	}

	idx := orderedIndices[0]
	leaves := make([][]byte, len(batchVal))
	for i, val := range batchVal {
		m.Hasher.Reset()
		m.Hasher.Write(val.ToBytes()) // Assuming MTLeaf has a toBytes() method or similar
		leaves[i] = m.Hasher.Sum(nil)
	}

	values := make([][]byte, len(proof.Values))
	copy(values, proof.Values)

	for idx > 0 {
		newHashes := make([][]byte, 0, len(orderedIndices))
		newIndices := make([]uint64, 0, len(orderedIndices))
		i := 0
		var err error
		idx, err = parent(idx)
		if err != nil {
			return err
		}
		for i < len(orderedIndices) {
			newIndex, err := parent(orderedIndices[i])
			if err != nil {
				return err
			}
			newIndices = append(newIndices, newIndex)
			if orderedIndices[i]&1 == 0 {
				m.Hasher.Reset()
				m.Hasher.Write(values[0])
				m.Hasher.Write(leaves[i])
				newHashes = append(newHashes, m.Hasher.Sum(nil))
				values = values[1:]
			} else {
				sibling, err := sibling(orderedIndices[i])
				if err != nil {
					return err
				}
				if i < len(orderedIndices)-1 && orderedIndices[i+1] == sibling {
					m.Hasher.Reset()
					m.Hasher.Write(leaves[i])
					m.Hasher.Write(leaves[i+1])
					newHashes = append(newHashes, m.Hasher.Sum(nil))
					i++
				} else if sibling < nrNodes {
					m.Hasher.Reset()
					m.Hasher.Write(leaves[i])
					m.Hasher.Write(values[0])
					newHashes = append(newHashes, m.Hasher.Sum(nil))
					values = values[1:]
				} else {
					m.Hasher.Reset()
					m.Hasher.Write(leaves[i])
					m.Hasher.Write(m.Hasher.Sum(nil)) // Assuming hashing of zero bytes
					newHashes = append(newHashes, m.Hasher.Sum(nil))
				}
			}
			i++
		}
		leaves = newHashes
		orderedIndices = newIndices
	}

	if len(leaves) == 1 && bytes.Equal(leaves[0], m.Root) {
		return nil
	}

	return fmt.Errorf("invalid batch path")
}

// ====================== MerkleTree implementation ======================
// Provided a non-empty list of leaves, `create` generates its corresponding `MerkleTree`.
func Create(leaves []MTLeaf) (*MerkleTree, error) {
	n := uint64(len(leaves))
	if n == 0 {
		return nil, fmt.Errorf("MerkleTree::create() called with no leaves")
	}

	numNodes := n + nextPowerOfTwo(n) - 1
	nodes := make([][]byte, numNodes)

	hasher, err := blake2b.New256(nil)
	if err != nil {
		return nil, fmt.Errorf("merkle tree hasher initialization error %v", err)
	}

	for i, leaf := range leaves {
		hasher.Reset()
		hasher.Write(leaf.ToBytes()) // Assuming MTLeaf has a method toBytes()
		nodes[numNodes-n+uint64(i)] = hasher.Sum(nil)
	}

	for i := int(numNodes) - int(n) - 1; i >= 0; i-- {
		hasher.Reset()
		left := leftChild(uint64(i))
		right := rightChild(uint64(i))
		if left < numNodes {
			hasher.Write(nodes[left])
		} else {
			hasher.Write([]byte{0}) // Assuming empty hash is 0 byte
		}
		if right < numNodes {
			hasher.Write(nodes[right])
		} else {
			hasher.Write([]byte{0}) // Assuming empty hash is 0 byte
		}
		nodes[i] = hasher.Sum(nil)
	}

	return &MerkleTree{
		Nodes:   nodes,
		LeafOff: numNodes - n,
		N:       n,
		Hasher:  hasher, // Assuming Hasher is a field or a suitable hash function
	}, nil
}

// Convert merkle tree to a commitment. This function simply returns the root.
func (mt *MerkleTree) ToCommitment() *MerkleTreeCommitment {
	return &MerkleTreeCommitment{
		Root:   mt.Nodes[0],
		Hasher: mt.Hasher,
	}
}

// Convert merkle tree to a batch compatible commitment.
// This function simply returns the root and the number of leaves in the tree.
func (mt *MerkleTree) ToCommitmentBatchCompat() *MerkleTreeCommitmentBatchCompat {
	return &MerkleTreeCommitmentBatchCompat{
		Root:     mt.Nodes[0],
		NrLeaves: mt.N,
		Hasher:   mt.Hasher,
	}
}

// Get a path (hashes of siblings of the path to the root node)
// for the `i`th value stored in the tree.
// Requires `i < self.n`
func (mt *MerkleTree) GetPath(i uint64) (*Path, error) {
	if i >= mt.N {
		return nil, fmt.Errorf("proof index out of bounds")
	}
	idx := mt.LeafOff + i
	proof := make([][]byte, 0)

	hasher, err := blake2b.New256(nil)
	if err != nil {
		return nil, fmt.Errorf("get path hasher initialization error %v", err)
	}

	for idx > 0 {
		sib, err := sibling(idx)
		if err != nil {
			return nil, err
		}
		if sib < uint64(len(mt.Nodes)) {
			proof = append(proof, mt.Nodes[sib])
		} else {
			proof = append(proof, hasher.Sum(nil)) // Assuming empty hash
		}
		idx, err = parent(idx)
		if err != nil {
			return nil, err
		}
	}

	return &Path{
		Values: proof,
		Index:  i,
		Hasher: mt.Hasher,
	}, nil
}

func (mt *MerkleTree) GetBatchedPath(indices []uint64) (*BatchPath, error) {
	if len(indices) == 0 {
		return nil, fmt.Errorf("get_batched_path() called with no indices")
	}

	for _, i := range indices {
		if i >= mt.N {
			return nil, fmt.Errorf("proof index out of bounds: asked for index out of range")
		}
	}

	orderedIndices := make([]uint64, len(indices))
	copy(orderedIndices, indices)
	sort.Slice(orderedIndices, func(i, j int) bool { return orderedIndices[i] < orderedIndices[j] })

	for i := range orderedIndices {
		if orderedIndices[i] != indices[i] {
			return nil, fmt.Errorf("indices should be ordered")
		}
	}

	for i := range orderedIndices {
		orderedIndices[i] = mt.idxOfLeaf(orderedIndices[i])
	}

	idx := orderedIndices[0]
	var proof [][]byte

	for idx > 0 {
		newIndices := make([]uint64, len(orderedIndices))
		i := 0
		var err error
		idx, err = parent(idx)
		if err != nil {
			return nil, err
		}
		for i < len(orderedIndices) {
			newIndices[i], err = parent(orderedIndices[i])
			if err != nil {
				return nil, err
			}
			sibling, err := sibling(orderedIndices[i])
			if err != nil {
				return nil, err
			}
			if i < len(orderedIndices)-1 && orderedIndices[i+1] == sibling {
				i++
			} else if sibling < uint64(len(mt.Nodes)) {
				proof = append(proof, mt.Nodes[sibling])
			}
			i++
		}
		copy(orderedIndices, newIndices)
	}

	return &BatchPath{
		Values:  proof,
		Indices: indices,
		Hasher:  mt.Hasher,
	}, nil
}

func (mt *MerkleTree) idxOfLeaf(index uint64) uint64 {
	return mt.LeafOff + index
}

// Remaining functions for the MerkleTree struct are not included as only
// verification-related functions are required for on-chain activities.
// This approach focuses on minimizing the codebase to essential operations,
// reducing complexity and potential attack surfaces in the blockchain environment.
