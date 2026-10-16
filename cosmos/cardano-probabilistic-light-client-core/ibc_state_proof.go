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
	if len(value) == 0 {
		return fmt.Errorf("membership requires a non-empty value")
	}
	if len(exist.Key) > 0 && !bytes.Equal(exist.Key, key) {
		return fmt.Errorf("existence proof key mismatch")
	}

	committedValue := value
	if len(exist.Value) > 0 {
		committedValue = exist.Value
	}
	if verifyCommittedValueMatchesExpected != nil {
		if err := verifyCommittedValueMatchesExpected(key, value, committedValue); err != nil {
			return err
		}
	} else if !bytes.Equal(committedValue, value) {
		return fmt.Errorf("existence proof value mismatch")
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
	if len(nonexist.Left.Key) > 0 && !bytes.Equal(nonexist.Left.Key, key) {
		return fmt.Errorf("non-existence proof left key mismatch")
	}
	if nonexist.Right != nil {
		return fmt.Errorf("sparse non-existence proof must not have a right existence proof")
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
	current := leafHash(key, value)
	if len(path) == 65 {
		descriptor := path[0]
		if descriptor == nil || descriptor.Hash != ics23.HashOp_SHA256 || len(descriptor.Suffix) != 0 {
			return nil, fmt.Errorf("invalid collision bucket operation")
		}
		var err error
		current, err = collisionBucketLeaf(key, value, descriptor.Prefix)
		if err != nil {
			return nil, err
		}
		path = path[1:]
	}
	if len(path) != 64 {
		return nil, fmt.Errorf("unexpected proof path length: %d", len(path))
	}

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

// Collision bucket descriptors precede the 64 ordinary sparse-tree operations.
// Every entry is a full SHA-256 key digest followed by a nonempty value digest.
// The old singleton commitment is retained when a bucket shrinks to one entry.
func collisionBucketLeaf(key, value, encoded []byte) ([]byte, error) {
	if len(encoded) < 65 || encoded[0] != 0x02 || (len(encoded)-1)%64 != 0 {
		return nil, fmt.Errorf("invalid collision bucket encoding")
	}
	requested := sha256.Sum256(key)
	valueDigest := sha256.Sum256(value)
	found := false
	var previous []byte
	for offset := 1; offset < len(encoded); offset += 64 {
		entryKey := encoded[offset : offset+32]
		entryValue := encoded[offset+32 : offset+64]
		if !bytes.Equal(entryKey[:8], requested[:8]) {
			return nil, fmt.Errorf("collision bucket entry belongs to a different path")
		}
		if previous != nil && bytes.Compare(previous, entryKey) >= 0 {
			return nil, fmt.Errorf("collision bucket keys must be strictly ordered")
		}
		if bytes.Equal(entryValue, emptyValueHash[:]) {
			return nil, fmt.Errorf("collision bucket contains an empty value")
		}
		if bytes.Equal(entryKey, requested[:]) {
			found = true
			if len(value) == 0 || !bytes.Equal(entryValue, valueDigest[:]) {
				return nil, fmt.Errorf("collision bucket value mismatch")
			}
		}
		previous = entryKey
	}
	if len(value) > 0 && !found {
		return nil, fmt.Errorf("collision bucket is missing the requested key")
	}
	if len(encoded) == 65 {
		preimage := append([]byte{0}, encoded[1:]...)
		digest := sha256.Sum256(preimage)
		return digest[:], nil
	}
	digest := sha256.Sum256(encoded)
	return digest[:], nil
}

func childOrderingFromInnerOp(direction uint64, op *ics23.InnerOp) (left []byte, right []byte, err error) {
	if op == nil {
		return nil, nil, fmt.Errorf("missing inner operation")
	}
	// Older compact proofs omit the hash field. Explicit operations must use
	// SHA-256, which is fixed by Cardano's commitment scheme.
	if op.Hash != ics23.HashOp_NO_HASH && op.Hash != ics23.HashOp_SHA256 {
		return nil, nil, fmt.Errorf("unsupported inner hash operation")
	}
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
	if len(jp.Proofs) != 1 || jp.Proofs[0].Exist == nil || jp.Proofs[0].Nonexist != nil {
		return nil, fmt.Errorf("expected existence proof")
	}
	return jp.Proofs[0].Exist.toExistenceProof()
}

func DecodeJSONNonExistenceProof(proofBytes []byte) (*ics23.NonExistenceProof, error) {
	var jp jsonMerkleProof
	if err := json.Unmarshal(proofBytes, &jp); err != nil {
		return nil, fmt.Errorf("unable to decode merkle proof bytes")
	}
	if len(jp.Proofs) != 1 || jp.Proofs[0].Nonexist == nil || jp.Proofs[0].Exist != nil {
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
		Hash   *int32 `json:"hash,omitempty"`
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
		hash := ics23.HashOp_SHA256
		if op.Hash != nil {
			hash = ics23.HashOp(*op.Hash)
		}
		proofPath = append(proofPath, &ics23.InnerOp{
			Hash:   hash,
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
