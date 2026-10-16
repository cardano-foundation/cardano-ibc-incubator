package signing

import (
	"fmt"
	"hash"
	"sort"

	merkleindex "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/internal/merkleindex"
	"golang.org/x/crypto/blake2b"
)

// Tree of hashes, providing a commitment of data and its ordering.
type MerkleTree struct {
	// The nodes are stored in an array heap:
	// * `nodes[0]` is the root,
	// * the parent of `nodes[i]` is `nodes[(i-1)/2]`
	// * the children of `nodes[i]` are `{nodes[2i + 1], nodes[2i + 2]}`
	// * All nodes have size `Output<D>::output_size()`, even leafs (which are hashed before committing them).
	Nodes [][]byte
	// The leaves begin at `nodes[leaf_off]`.
	LeafOff uint64
	// Number of leaves cached in the merkle tree.
	N uint64
	// Phantom type to link the tree with its hasher
	Hasher hash.Hash
}

// ====================== MerkleTree implementation ======================
// Provided a non-empty list of leaves, `create` generates its corresponding `MerkleTree`.
func Create(leaves []MTLeaf) (*MerkleTree, error) {
	n := uint64(len(leaves))
	if n == 0 {
		return nil, fmt.Errorf("MerkleTree::create() called with no leaves")
	}

	numNodes := n + merkleindex.NextPowerOfTwo(n) - 1
	nodes := make([][]byte, numNodes)

	hasher, err := blake2b.New256(nil)
	if err != nil {
		return nil, fmt.Errorf("merkle tree hasher initialization error %v", err)
	}

	for i, leaf := range leaves {
		hasher.Reset()
		hasher.Write(leaf.ToBytes())
		nodes[numNodes-n+uint64(i)] = hasher.Sum(nil)
	}

	// A missing child contributes the hash of a zero byte, as in mithril-stm
	// and the batch verifier above.
	hasher.Reset()
	hasher.Write([]byte{0})
	empty := hasher.Sum(nil)
	for i := int(numNodes) - int(n) - 1; i >= 0; i-- {
		hasher.Reset()
		left := leftChild(uint64(i))
		right := rightChild(uint64(i))
		if left < numNodes {
			hasher.Write(nodes[left])
		} else {
			hasher.Write(empty)
		}
		if right < numNodes {
			hasher.Write(nodes[right])
		} else {
			hasher.Write(empty)
		}
		nodes[i] = hasher.Sum(nil)
	}

	return &MerkleTree{
		Nodes:   nodes,
		LeafOff: numNodes - n,
		N:       n,
		Hasher:  hasher,
	}, nil
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
		// Each level keeps one parent per sibling pair, as in mithril-stm.
		newIndices := make([]uint64, 0, len(orderedIndices))
		i := 0
		var err error
		idx, err = merkleindex.Parent(idx)
		if err != nil {
			return nil, err
		}
		for i < len(orderedIndices) {
			parentIndex, err := merkleindex.Parent(orderedIndices[i])
			if err != nil {
				return nil, err
			}
			newIndices = append(newIndices, parentIndex)
			sibling, err := merkleindex.Sibling(orderedIndices[i])
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
		orderedIndices = newIndices
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

// leftChild returns the index of the left child of the given node.
func leftChild(index uint64) uint64 {
	return (2 * index) + 1
}

// rightChild returns the index of the right child of the given node.
func rightChild(index uint64) uint64 {
	return (2 * index) + 2
}
