package crypto

import (
	"fmt"
	"sync"
)

type RegParty = MTLeaf

type KeyReg struct {
	mu   sync.RWMutex
	Keys map[*VerificationKey]Stake
}

type ClosedKeyReg struct {
	RegParties []RegParty
	TotalStake Stake
	MerkleTree *MerkleTree
}

// ====================== KeyReg implementation ======================
// Verify and register a public key and stake for a particular party.
// # Error
// The function fails when the proof of possession is invalid or when the key is already registered.
func (kr *KeyReg) Register(stake Stake, pk VerificationKeyPoP) error {
	kr.mu.Lock()
	defer kr.mu.Unlock()

	if _, exists := kr.Keys[pk.VK]; !exists {
		if err := pk.Check(); err == nil {
			kr.Keys[pk.VK] = stake
			return nil
		} else {
			return fmt.Errorf("key invalid")
		}
	}
	return fmt.Errorf("key already registered")
}

// Finalize the key registration.
// This function disables `KeyReg::register`, consumes the instance of `self`, and returns a `ClosedKeyReg`.
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
		regParties = append(regParties, RegParty{vk, stake})
	}

	// Sort regParties if necessary. Go does not have a sort functionality for custom structs out-of-the-box like Rust.
	// You would need to implement sort.Interface or use sort.Slice with a custom less function.

	merkleTree, err := Create(regParties)
	if err != nil {
		return nil, err
	}

	return &ClosedKeyReg{
		RegParties: regParties,
		TotalStake: totalStake,
		MerkleTree: merkleTree, // Assuming a constructor function for MerkleTree
	}, nil
}
