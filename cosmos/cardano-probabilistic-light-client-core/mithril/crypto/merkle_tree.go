package crypto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"hash"
	"sort"

	merkleindex "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/internal/merkleindex"
)

// The values that are committed in the Merkle Tree.
// Namely, a verified `VerificationKey` and its corresponding stake.
type MTLeaf struct {
	*VerificationKey
	Stake
}

// Path of hashes for a batch of indices.
// Contains the hashes and the corresponding merkle tree indices of given batch.
// Used to verify the signatures are issued by the registered signers.
type BatchPath struct {
	Values  [][]byte  `json:"values,omitempty"`
	Indices []uint64  `json:"indices,omitempty"`
	Hasher  hash.Hash `json:"hasher,omitempty"`
}

// The anchored root and leaf count used for batch membership verification.
type MerkleTreeCommitmentBatchCompat struct {
	// Root of the merkle commitment.
	Root     []byte    `json:"root,omitempty"`
	NrLeaves uint64    `json:"nr_leaves,omitempty"`
	Hasher   hash.Hash `json:"hasher,omitempty"`
}

// ToBytes encodes the 96-byte compressed G2 key followed by big-endian u64 stake.
func (leaf *MTLeaf) ToBytes() []byte {
	var result [104]byte
	copy(result[:96], leaf.VerificationKey.ToBytes())

	var bytes [8]byte
	binary.BigEndian.PutUint64(bytes[:], uint64(leaf.Stake))
	copy(result[96:], bytes[:])
	return result[:]
}

// Mithril-stm signs message || root. The leaf count is used by batch-path
// verification and is not signed here. The pinned upstream aggregates in
// TestUpstreamAggregatesVerifyAndLostIndicesAreRejected verify this encoding.
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
// Check follows mithril-stm's verify_leaves_membership_from_batch_path,
// including its checked arithmetic, and rejects malformed proofs without panicking.
func (m *MerkleTreeCommitmentBatchCompat) Check(batchVal []MTLeaf, proof *BatchPath) error {
	if proof == nil || len(batchVal) != len(proof.Indices) || len(batchVal) == 0 {
		return fmt.Errorf("batch value length does not match proof indices length")
	}

	orderedIndices := make([]uint64, len(proof.Indices))
	copy(orderedIndices, proof.Indices)
	sort.Slice(orderedIndices, func(i, j int) bool { return orderedIndices[i] < orderedIndices[j] })

	if !bytes.Equal(toByteSlice(orderedIndices), toByteSlice(proof.Indices)) {
		return fmt.Errorf("proof indices are not ordered")
	}

	leavesPowerOfTwo := merkleindex.NextPowerOfTwo(m.NrLeaves)
	if m.NrLeaves == 0 || leavesPowerOfTwo < m.NrLeaves || m.NrLeaves > ^uint64(0)-leavesPowerOfTwo+1 {
		return fmt.Errorf("batch path tree size overflows")
	}
	nrNodes := m.NrLeaves + leavesPowerOfTwo - 1
	for i, index := range orderedIndices {
		if index > ^uint64(0)-leavesPowerOfTwo+1 {
			return fmt.Errorf("batch path index overflows")
		}
		orderedIndices[i] = index + leavesPowerOfTwo - 1
	}

	idx := orderedIndices[0]
	leaves := make([][]byte, len(batchVal))
	for i, val := range batchVal {
		m.Hasher.Reset()
		m.Hasher.Write(val.ToBytes())
		leaves[i] = m.Hasher.Sum(nil)
	}

	values := make([][]byte, len(proof.Values))
	copy(values, proof.Values)

	for idx > 0 {
		newHashes := make([][]byte, 0, len(orderedIndices))
		newIndices := make([]uint64, 0, len(orderedIndices))
		i := 0
		var err error
		idx, err = merkleindex.Parent(idx)
		if err != nil {
			return err
		}
		for i < len(orderedIndices) {
			newIndex, err := merkleindex.Parent(orderedIndices[i])
			if err != nil {
				return err
			}
			newIndices = append(newIndices, newIndex)
			if orderedIndices[i]&1 == 0 {
				if len(values) == 0 {
					return fmt.Errorf("batch path has too few nodes")
				}
				m.Hasher.Reset()
				m.Hasher.Write(values[0])
				m.Hasher.Write(leaves[i])
				newHashes = append(newHashes, m.Hasher.Sum(nil))
				values = values[1:]
			} else {
				sibling, err := merkleindex.Sibling(orderedIndices[i])
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
					if len(values) == 0 {
						return fmt.Errorf("batch path has too few nodes")
					}
					m.Hasher.Reset()
					m.Hasher.Write(leaves[i])
					m.Hasher.Write(values[0])
					newHashes = append(newHashes, m.Hasher.Sum(nil))
					values = values[1:]
				} else {
					m.Hasher.Reset()
					m.Hasher.Write([]byte{0})
					zeroHash := m.Hasher.Sum(nil)

					m.Hasher.Reset()
					m.Hasher.Write(leaves[i])
					m.Hasher.Write(zeroHash)
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

// RegParty is the public verification key and stake committed by an anchor.
type RegParty = MTLeaf
