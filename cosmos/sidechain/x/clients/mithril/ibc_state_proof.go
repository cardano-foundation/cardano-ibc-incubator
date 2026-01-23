package mithril

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"

	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	ics23 "github.com/cosmos/ics23/go"
)

var (
	emptyHash      = make([]byte, 32)
	emptyValueHash = sha256.Sum256([]byte{})
)

// VerifyIbcStateMembership verifies a Gateway-provided proof for `key -> value`
// against an authenticated `ibc_state_root`.
//
// This verifier mirrors the on-chain commitment scheme in:
// `cardano/onchain/lib/ibc/core/ics-025-handler-interface/ibc_state_commitment.ak`.
//
// Important details:
//   - The leaf hash commits to the value only.
//   - The key is bound by enforcing a deterministic key->path derivation:
//     we derive a 64-bit path selector from the first 8 bytes of sha256(key).
//   - The proof path is always 64 steps (fixed-depth binary tree).
//
// Proof encoding:
//   - Preferred: standard protobuf `MerkleProof` bytes (IBC / ICS-23).
//   - Backwards-compatible: the Gateway currently returns a JSON-encoded proof with
//     the same logical fields (key/value + 64 sibling hashes encoded as InnerOps).
func VerifyIbcStateMembership(root []byte, key []byte, value []byte, proofBytes []byte) error {
	exist, err := decodeExistenceProof(proofBytes)
	if err != nil {
		return err
	}

	if len(exist.Key) > 0 && !bytes.Equal(exist.Key, key) {
		return fmt.Errorf("existence proof key mismatch")
	}
	if len(exist.Value) > 0 && !bytes.Equal(exist.Value, value) {
		return fmt.Errorf("existence proof value mismatch")
	}

	computed, err := computeRootFromProofPath(key, value, exist.Path)
	if err != nil {
		return err
	}

	if !bytes.Equal(computed, root) {
		return fmt.Errorf("proof does not match ibc_state_root")
	}

	return nil
}

// VerifyIbcStateNonMembership verifies that `key` is absent under `root`.
//
// In this commitment scheme, absence is represented by an empty value, which
// maps to the all-zero leaf hash on-chain.
func VerifyIbcStateNonMembership(root []byte, key []byte, proofBytes []byte) error {
	nonexist, err := decodeNonExistenceProof(proofBytes)
	if err != nil {
		return err
	}

	if nonexist.Key != nil && !bytes.Equal(nonexist.Key, key) {
		return fmt.Errorf("non-existence proof key mismatch")
	}

	if nonexist.Left == nil {
		return fmt.Errorf("non-existence proof missing left existence proof")
	}

	// The Gateway models absence as membership of an empty value.
	if len(nonexist.Left.Value) != 0 {
		return fmt.Errorf("non-existence proof left value must be empty")
	}

	computed, err := computeRootFromProofPath(key, []byte{}, nonexist.Left.Path)
	if err != nil {
		return err
	}

	if !bytes.Equal(computed, root) {
		return fmt.Errorf("proof does not match ibc_state_root")
	}

	return nil
}

func computeRootFromProofPath(key []byte, value []byte, path []*ics23.InnerOp) ([]byte, error) {
	if len(path) != 64 {
		return nil, fmt.Errorf("unexpected proof path length: %d", len(path))
	}

	current := leafHash(value)

	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[0:8])

	for depth, op := range path {
		direction := (index >> uint(depth)) & 1

		left, right, err := childOrderingFromInnerOp(direction, op)
		if err != nil {
			return nil, err
		}

		if direction == 0 {
			// current node is on the left
			left = current
		} else {
			// current node is on the right
			right = current
		}

		current = innerHash(left, right)
	}

	return current, nil
}

func childOrderingFromInnerOp(direction uint64, op *ics23.InnerOp) (left []byte, right []byte, err error) {
	// Expected encoding:
	// - left child:  sha256(0x01 || current || sibling) => prefix=0x01, suffix=sibling
	// - right child: sha256(0x01 || sibling || current) => prefix=0x01||sibling, suffix=""
	if direction == 0 {
		if len(op.Prefix) != 1 || op.Prefix[0] != 0x01 {
			return nil, nil, fmt.Errorf("invalid inner op prefix for left child")
		}
		if len(op.Suffix) != 32 {
			return nil, nil, fmt.Errorf("invalid inner op suffix length for left child")
		}
		return nil, op.Suffix, nil
	}

	if len(op.Suffix) != 0 {
		return nil, nil, fmt.Errorf("invalid inner op suffix for right child")
	}
	if len(op.Prefix) != 33 || op.Prefix[0] != 0x01 {
		return nil, nil, fmt.Errorf("invalid inner op prefix for right child")
	}
	return op.Prefix[1:], nil, nil
}

func leafHash(value []byte) []byte {
	valueHash := sha256.Sum256(value)
	if valueHash == emptyValueHash {
		return emptyHash
	}
	leafPreimage := append([]byte{0x00}, valueHash[:]...)
	h := sha256.Sum256(leafPreimage)
	return h[:]
}

func innerHash(left []byte, right []byte) []byte {
	if len(left) != 32 || len(right) != 32 {
		// We keep error handling in the caller; this should never happen for
		// validated proofs.
		return nil
	}
	if bytes.Equal(left, emptyHash) && bytes.Equal(right, emptyHash) {
		return emptyHash
	}
	preimage := make([]byte, 0, 1+32+32)
	preimage = append(preimage, 0x01)
	preimage = append(preimage, left...)
	preimage = append(preimage, right...)
	h := sha256.Sum256(preimage)
	return h[:]
}

func decodeExistenceProof(proofBytes []byte) (*ics23.ExistenceProof, error) {
	// Preferred: standard protobuf MerkleProof bytes.
	var mp commitmenttypes.MerkleProof
	if err := mp.Unmarshal(proofBytes); err == nil {
		if len(mp.Proofs) == 0 {
			return nil, fmt.Errorf("empty merkle proof")
		}
		exist := mp.Proofs[0].GetExist()
		if exist == nil {
			return nil, fmt.Errorf("expected existence proof")
		}
		return exist, nil
	}

	// Backwards-compatible: Gateway JSON placeholder proof.
	var jp jsonMerkleProof
	if err := json.Unmarshal(proofBytes, &jp); err != nil {
		return nil, fmt.Errorf("unable to decode merkle proof bytes")
	}
	if len(jp.Proofs) == 0 || jp.Proofs[0].Exist == nil {
		return nil, fmt.Errorf("expected existence proof")
	}
	return jp.Proofs[0].Exist.toExistenceProof()
}

func decodeNonExistenceProof(proofBytes []byte) (*ics23.NonExistenceProof, error) {
	var mp commitmenttypes.MerkleProof
	if err := mp.Unmarshal(proofBytes); err == nil {
		if len(mp.Proofs) == 0 {
			return nil, fmt.Errorf("empty merkle proof")
		}
		nonexist := mp.Proofs[0].GetNonexist()
		if nonexist == nil {
			return nil, fmt.Errorf("expected non-existence proof")
		}
		return nonexist, nil
	}

	var jp jsonMerkleProof
	if err := json.Unmarshal(proofBytes, &jp); err != nil {
		return nil, fmt.Errorf("unable to decode merkle proof bytes")
	}
	if len(jp.Proofs) == 0 || jp.Proofs[0].Nonexist == nil {
		return nil, fmt.Errorf("expected non-existence proof")
	}
	return jp.Proofs[0].Nonexist.toNonExistenceProof()
}

type jsonMerkleProof struct {
	Proofs []struct {
		Exist    *jsonExistenceProof    `json:"exist,omitempty"`
		Nonexist *jsonNonExistenceProof `json:"nonexist,omitempty"`
	} `json:"proofs"`
}

type jsonExistenceProof struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	Path  []struct {
		Prefix string `json:"prefix"`
		Suffix string `json:"suffix"`
	} `json:"path"`
}

func (p *jsonExistenceProof) toExistenceProof() (*ics23.ExistenceProof, error) {
	key, err := hex.DecodeString(p.Key)
	if err != nil {
		return nil, err
	}
	value, err := hex.DecodeString(p.Value)
	if err != nil {
		return nil, err
	}

	var path []*ics23.InnerOp
	for _, op := range p.Path {
		prefix, err := hex.DecodeString(op.Prefix)
		if err != nil {
			return nil, err
		}
		suffix, err := hex.DecodeString(op.Suffix)
		if err != nil {
			return nil, err
		}
		path = append(path, &ics23.InnerOp{
			Hash:   ics23.HashOp_SHA256,
			Prefix: prefix,
			Suffix: suffix,
		})
	}

	return &ics23.ExistenceProof{
		Key:   key,
		Value: value,
		Path:  path,
	}, nil
}

type jsonNonExistenceProof struct {
	Key   string              `json:"key"`
	Left  *jsonExistenceProof `json:"left"`
	Right *jsonExistenceProof `json:"right"`
}

func (p *jsonNonExistenceProof) toNonExistenceProof() (*ics23.NonExistenceProof, error) {
	key, err := hex.DecodeString(p.Key)
	if err != nil {
		return nil, err
	}

	var left *ics23.ExistenceProof
	if p.Left != nil {
		left, err = p.Left.toExistenceProof()
		if err != nil {
			return nil, err
		}
	}

	var right *ics23.ExistenceProof
	if p.Right != nil {
		right, err = p.Right.toExistenceProof()
		if err != nil {
			return nil, err
		}
	}

	return &ics23.NonExistenceProof{
		Key:   key,
		Left:  left,
		Right: right,
	}, nil
}
