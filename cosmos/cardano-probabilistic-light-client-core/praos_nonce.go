package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"fmt"

	"golang.org/x/crypto/blake2b"
)

// Empty bytes encode Cardano's NeutralNonce identity, not an all-zero hash.
func ValidatePraosNonce(nonce []byte) error {
	if len(nonce) != 0 && len(nonce) != 32 {
		return fmt.Errorf("Praos nonce must be neutral or 32 bytes, got %d", len(nonce))
	}
	return nil
}

// CombinePraosNonces implements Cardano.Ledger.BaseTypes.(⭒).
func CombinePraosNonces(left, right []byte) ([]byte, error) {
	if err := ValidatePraosNonce(left); err != nil {
		return nil, err
	}
	if err := ValidatePraosNonce(right); err != nil {
		return nil, err
	}
	if len(left) == 0 {
		return bytes.Clone(right), nil
	}
	if len(right) == 0 {
		return bytes.Clone(left), nil
	}
	var input [64]byte
	copy(input[:32], left)
	copy(input[32:], right)
	hash := blake2b.Sum256(input[:])
	return hash[:], nil
}

// PraosNonceContribution ports Cardano.Protocol.Praos.VRF.vrfNonceValue.
// Range extension uses the nonce-specific "N" prefix. The resulting hash is
// hashed again to make a nonce. Neither the raw output nor the proof is a nonce.
func PraosNonceContribution(verifiedVRFOutput []byte) ([]byte, error) {
	if len(verifiedVRFOutput) != 64 {
		return nil, fmt.Errorf("Praos VRF output must be 64 bytes, got %d", len(verifiedVRFOutput))
	}
	var input [65]byte
	input[0] = 'N'
	copy(input[1:], verifiedVRFOutput)
	rangeExtended := blake2b.Sum256(input[:])
	nonce := blake2b.Sum256(rangeExtended[:])
	return nonce[:], nil
}

// PraosPreviousHashNonce implements prevHashToNonce/hashHeaderToNonce. A
// block hash is already a 32-byte Blake2b hash and is cast, not hashed again.
func PraosPreviousHashNonce(previousBlockHash string) ([]byte, error) {
	if previousBlockHash == "" {
		return nil, nil
	} // GenesisHash
	hash, err := hex.DecodeString(previousBlockHash)
	if err != nil || len(hash) != 32 {
		return nil, fmt.Errorf("previous block hash must be 32 bytes")
	}
	return hash, nil
}
