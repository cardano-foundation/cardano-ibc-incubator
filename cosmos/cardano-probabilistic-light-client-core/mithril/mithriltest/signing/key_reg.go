package signing

import (
	"fmt"
	"sync"
)

type KeyReg struct {
	mu   sync.RWMutex
	Keys map[*VerificationKey]Stake
}

type ClosedKeyReg struct {
	RegParties []RegParty
	TotalStake Stake
	MerkleTree *MerkleTree
}

// Close builds the local registration and Merkle tree used by the signers.
func (kr *KeyReg) Close() (*ClosedKeyReg, error) {
	kr.mu.Lock()
	defer kr.mu.Unlock()

	totalStake := Stake(0)
	regParties := make([]RegParty, 0, len(kr.Keys))

	for vk, stake := range kr.Keys {
		newStake := totalStake + stake
		if newStake < totalStake { // Check for overflow
			return nil, fmt.Errorf("total stake overflow")
		}
		totalStake = newStake
		regParties = append(regParties, RegParty{VerificationKey: vk, Stake: stake})
	}

	// The same local registration order is used by the signers and the tree.

	merkleTree, err := Create(regParties)
	if err != nil {
		return nil, err
	}

	return &ClosedKeyReg{
		RegParties: regParties,
		TotalStake: totalStake,
		MerkleTree: merkleTree,
	}, nil
}
