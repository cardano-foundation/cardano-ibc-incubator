package probabilisticcore

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"

	ics23 "github.com/cosmos/ics23/go"
)

var (
	emptyHash      = make([]byte, 32)
	emptyValueHash = sha256.Sum256([]byte{})
)

func VerifyIbcStateMembershipWithExistenceProof(
	root []byte,
	key []byte,
	value []byte,
	exist *ics23.ExistenceProof,
	verifyCommittedValueMatchesExpected func(key []byte, expectedValue []byte, committedValue []byte) error,
) error {
	if exist == nil {
		return fmt.Errorf("expected existence proof")
	}
	if len(exist.Key) > 0 && !bytes.Equal(exist.Key, key) {
		return fmt.Errorf("existence proof key mismatch")
	}

	if len(exist.Value) > 0 && !bytes.Equal(exist.Value, value) {
		if verifyCommittedValueMatchesExpected == nil {
			return fmt.Errorf("existence proof value mismatch")
		}
		if err := verifyCommittedValueMatchesExpected(key, value, exist.Value); err != nil {
			return err
		}
	}

	committedValue := value
	if len(exist.Value) > 0 {
		committedValue = exist.Value
	}

	computed, err := ComputeRootFromProofPath(key, committedValue, exist.Path)
	if err != nil {
		return err
	}

	if !bytes.Equal(computed, root) {
		return fmt.Errorf("proof does not match ibc_state_root")
	}

	return nil
}

func VerifyIbcStateNonMembershipWithNonExistenceProof(root []byte, key []byte, nonexist *ics23.NonExistenceProof) error {
	if nonexist == nil {
		return fmt.Errorf("expected non-existence proof")
	}
	if nonexist.Key != nil && !bytes.Equal(nonexist.Key, key) {
		return fmt.Errorf("non-existence proof key mismatch")
	}
	if nonexist.Left == nil {
		return fmt.Errorf("non-existence proof missing left existence proof")
	}
	if len(nonexist.Left.Value) != 0 {
		return fmt.Errorf("non-existence proof left value must be empty")
	}

	computed, err := ComputeRootFromProofPath(key, []byte{}, nonexist.Left.Path)
	if err != nil {
		return err
	}
	if !bytes.Equal(computed, root) {
		return fmt.Errorf("proof does not match ibc_state_root")
	}
	return nil
}

func ComputeRootFromProofPath(key []byte, value []byte, path []*ics23.InnerOp) ([]byte, error) {
	if len(path) != 64 {
		return nil, fmt.Errorf("unexpected proof path length: %d", len(path))
	}

	current := leafHash(key, value)

	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[0:8])

	for depth, op := range path {
		direction := (index >> uint(depth)) & 1

		left, right, err := childOrderingFromInnerOp(direction, op)
		if err != nil {
			return nil, err
		}

		if direction == 0 {
			left = current
		} else {
			right = current
		}

		current = innerHash(left, right)
	}

	return current, nil
}

func childOrderingFromInnerOp(direction uint64, op *ics23.InnerOp) (left []byte, right []byte, err error) {
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

func leafHash(key []byte, value []byte) []byte {
	valueHash := sha256.Sum256(value)
	if valueHash == emptyValueHash {
		return emptyHash
	}
	keyHash := sha256.Sum256(key)
	leafPreimage := make([]byte, 0, 1+32+32)
	leafPreimage = append(leafPreimage, 0x00)
	leafPreimage = append(leafPreimage, keyHash[:]...)
	leafPreimage = append(leafPreimage, valueHash[:]...)
	h := sha256.Sum256(leafPreimage)
	return h[:]
}

func innerHash(left []byte, right []byte) []byte {
	if len(left) != 32 || len(right) != 32 {
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

func DecodeJSONExistenceProof(proofBytes []byte) (*ics23.ExistenceProof, error) {
	var jp jsonMerkleProof
	if err := json.Unmarshal(proofBytes, &jp); err != nil {
		return nil, fmt.Errorf("unable to decode merkle proof bytes")
	}
	if len(jp.Proofs) == 0 || jp.Proofs[0].Exist == nil {
		return nil, fmt.Errorf("expected existence proof")
	}
	return jp.Proofs[0].Exist.toExistenceProof()
}

func DecodeJSONNonExistenceProof(proofBytes []byte) (*ics23.NonExistenceProof, error) {
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

	var proofPath []*ics23.InnerOp
	for _, op := range p.Path {
		prefix, err := hex.DecodeString(op.Prefix)
		if err != nil {
			return nil, err
		}
		suffix, err := hex.DecodeString(op.Suffix)
		if err != nil {
			return nil, err
		}
		proofPath = append(proofPath, &ics23.InnerOp{
			Hash:   ics23.HashOp_SHA256,
			Prefix: prefix,
			Suffix: suffix,
		})
	}

	return &ics23.ExistenceProof{
		Key:   key,
		Value: value,
		Path:  proofPath,
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
