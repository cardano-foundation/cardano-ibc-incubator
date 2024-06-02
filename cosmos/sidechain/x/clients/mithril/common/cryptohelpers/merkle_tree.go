package cryptohelpers

import (
	"fmt"

	"github.com/ComposableFi/go-merkle-trees/mmr"
	"golang.org/x/crypto/blake2s"
)

type MKTreeLeafPosition = uint64

type MKTreeNode struct {
	Hash []byte
}

type MKProof struct {
	InnerRoot   *MKTreeNode
	InnerLeaves []*struct {
		MKTreeLeafPosition
		MKTreeNode
	}
	InnerProofSize  uint64
	InnerProofItems []*MKTreeNode
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

func (proof *MKProof) Verify() error {
	proofItems := [][]byte{}
	for _, innerProofItem := range proof.InnerProofItems {
		proofItems = append(proofItems, innerProofItem.Hash)
	}

	merkleProof := mmr.NewProof(
		proof.InnerProofSize,
		proofItems,
		nil,
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
