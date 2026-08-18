package cryptohelpers

import (
	"encoding/json"
	"fmt"
	"math/bits"

	"github.com/ComposableFi/go-merkle-trees/mmr"
	"github.com/ComposableFi/go-merkle-trees/types"
	"golang.org/x/crypto/blake2s"
)

type MKTreeLeafPosition = uint64

type MKTreeNode struct {
	Hash []byte `json:"hash"`
}

func (node *MKTreeNode) Add(other *MKTreeNode) *MKTreeNode {
	hasher, _ := blake2s.New256(nil)
	hasher.Write(node.Hash)
	hasher.Write(other.Hash)
	hashMerge := hasher.Sum(nil)
	return &MKTreeNode{
		Hash: hashMerge,
	}
}

type InnerLeaf struct {
	MKTreeLeafPosition
	*MKTreeNode
}

type MKProof struct {
	InnerRoot       *MKTreeNode   `json:"inner_root"`
	InnerLeaves     []*InnerLeaf  `json:"inner_leaves"`
	InnerProofSize  uint64        `json:"inner_proof_size"`
	InnerProofItems []*MKTreeNode `json:"inner_proof_items"`
}

func (p *MKProof) UnmarshalJSON(data []byte) error {
	var response struct {
		InnerRoot       *MKTreeNode     `json:"inner_root"`
		InnerLeaves     [][]interface{} `json:"inner_leaves"`
		InnerProofSize  uint64          `json:"inner_proof_size"`
		InnerProofItems []*MKTreeNode   `json:"inner_proof_items"`
	}

	if err := json.Unmarshal(data, &response); err != nil {
		return err
	}

	innerLeaves := []*InnerLeaf{}

	for _, il := range response.InnerLeaves {
		if len(il) != 2 {
			return fmt.Errorf("invalid inner leaf format")
		}

		position, ok := il[0].(float64)
		if !ok {
			return fmt.Errorf("invalid inner leaf format: invalid position format")
		}

		mtNode, ok := il[1].(map[string]interface{})
		if !ok {
			return fmt.Errorf("invalid inner leaf format: invalid merkle tree node format")
		}

		mtNodeHash, ok := mtNode["hash"].([]interface{})
		if !ok {
			return fmt.Errorf("invalid inner leaf format: invalid merkle tree node hash format")
		}

		mtNodeHashBytes := make([]byte, len(mtNodeHash))
		for i := 0; i < len(mtNodeHash); i++ {
			floatByte, ok := mtNodeHash[i].(float64)
			if !ok {
				return fmt.Errorf("invalid inner leaf format: invalid merkle tree node hash byte")
			}
			intByte := byte(floatByte)
			mtNodeHashBytes[i] = intByte
		}

		positionUint64 := uint64(position)

		innerLeaves = append(innerLeaves, &InnerLeaf{
			MKTreeLeafPosition: positionUint64,
			MKTreeNode: &MKTreeNode{
				Hash: mtNodeHashBytes,
			},
		})
	}

	p.InnerRoot = response.InnerRoot
	p.InnerLeaves = innerLeaves
	p.InnerProofSize = response.InnerProofSize
	p.InnerProofItems = response.InnerProofItems

	return nil
}

type Blake2s256Hasher struct{}

func (h *Blake2s256Hasher) Hash(data []byte) ([]byte, error) {
	hasher, err := blake2s.New256(nil)
	if err != nil {
		return nil, err
	}
	hasher.Write(data)
	return hasher.Sum(nil), nil
}

func LeafIndexToPos(index uint64) uint64 {
	return LeafIndexToMMRSize(index) - uint64(bits.TrailingZeros64(index+1)) - 1
}

func LeafIndexToMMRSize(index uint64) uint64 {
	var leavesCount = index + 1
	var peakCount = bits.OnesCount64(leavesCount)
	return 2*leavesCount - uint64(peakCount)
}

func LeafPosToIndex(position uint64) uint64 {
	var left uint64 = 0
	var right uint64 = position
	for left <= right {
		var mid = (left + right) / 2
		var midPos = LeafIndexToPos(mid)
		if midPos == position {
			return mid
		} else if midPos < position {
			left = mid + 1
		} else {
			right = mid - 1
		}
	}
	return ^uint64(0) // return max uint64 value if not found
}

func (proof *MKProof) Verify() error {
	proofItems := [][]byte{}
	for _, innerProofItem := range proof.InnerProofItems {
		proofItems = append(proofItems, innerProofItem.Hash)
	}

	mmrLeaves := []types.Leaf{}
	for _, innerLeaf := range proof.InnerLeaves {
		mmrLeaves = append(mmrLeaves, types.Leaf{
			Index: LeafPosToIndex(innerLeaf.MKTreeLeafPosition),
			Hash:  innerLeaf.Hash,
		})
	}

	merkleProof := mmr.NewProof(
		proof.InnerProofSize,
		proofItems,
		mmrLeaves,
		&Blake2s256Hasher{},
	)
	if merkleProof.Verify(proof.InnerRoot.Hash) {
		return nil
	} else {
		return fmt.Errorf("invalid MKProof")
	}
}

func (proof *MKProof) Contains(leaves []*MKTreeNode) error {
	leafFound := func(leaf *MKTreeNode) bool {
		for _, innerLeaf := range proof.InnerLeaves {
			if string(innerLeaf.MKTreeNode.Hash) == string(leaf.Hash) {
				return true
			}
		}
		return false
	}

	for _, leaf := range leaves {
		if !leafFound(leaf) {
			return fmt.Errorf("leaves not found in the MKProof")
		}
	}

	return nil
}
