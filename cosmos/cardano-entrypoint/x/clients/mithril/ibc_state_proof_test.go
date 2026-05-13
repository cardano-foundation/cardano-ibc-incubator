package mithril

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"

	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestVerifyIbcStateMembership_JSONProof(t *testing.T) {
	key := []byte("clients/07-tendermint-0/clientState")
	value := []byte{0x01, 0x02, 0x03}

	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[0:8])

	path := make([]*ics23.InnerOp, 0, 64)
	for depth := 0; depth < 64; depth++ {
		sib := sha256.Sum256([]byte(fmt.Sprintf("sib-%d", depth)))
		bit := (index >> uint(depth)) & 1

		if bit == 0 {
			path = append(path, &ics23.InnerOp{
				Hash:   ics23.HashOp_SHA256,
				Prefix: []byte{0x01},
				Suffix: sib[:],
			})
		} else {
			prefix := append([]byte{0x01}, sib[:]...)
			path = append(path, &ics23.InnerOp{
				Hash:   ics23.HashOp_SHA256,
				Prefix: prefix,
				Suffix: []byte{},
			})
		}
	}

	root, err := computeRootFromProofPath(key, value, path)
	require.NoError(t, err)

	proofBytes := mustJSONExistenceProof(t, key, value, path)

	require.NoError(t, VerifyIbcStateMembership(root, key, value, proofBytes))
	require.Error(t, VerifyIbcStateMembership(root, key, []byte{0xFF}, proofBytes))
	require.Error(t, VerifyIbcStateMembership(root, []byte("clients/07-tendermint-1/clientState"), value, proofBytes))
}

func TestVerifyIbcStateMembership_RejectsWrongInnerOpOrientation(t *testing.T) {
	key := []byte("clients/07-tendermint-0/clientState")
	value := []byte{0x01, 0x02, 0x03}

	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[0:8])

	path := make([]*ics23.InnerOp, 0, 64)
	siblings := make([][32]byte, 0, 64)
	for depth := 0; depth < 64; depth++ {
		sib := sha256.Sum256([]byte(fmt.Sprintf("sib-%d", depth)))
		siblings = append(siblings, sib)

		bit := (index >> uint(depth)) & 1
		if bit == 0 {
			path = append(path, &ics23.InnerOp{
				Hash:   ics23.HashOp_SHA256,
				Prefix: []byte{0x01},
				Suffix: sib[:],
			})
		} else {
			prefix := append([]byte{0x01}, sib[:]...)
			path = append(path, &ics23.InnerOp{
				Hash:   ics23.HashOp_SHA256,
				Prefix: prefix,
				Suffix: []byte{},
			})
		}
	}

	root, err := computeRootFromProofPath(key, value, path)
	require.NoError(t, err)

	// Corrupt the first step by forcing the opposite encoding.
	if (index & 1) == 0 {
		// Key expects "left child", but we encode it as "right child".
		path[0].Prefix = append([]byte{0x01}, siblings[0][:]...)
		path[0].Suffix = []byte{}
	} else {
		// Key expects "right child", but we encode it as "left child".
		path[0].Prefix = []byte{0x01}
		path[0].Suffix = siblings[0][:]
	}

	proofBytes := mustJSONExistenceProof(t, key, value, path)
	require.Error(t, VerifyIbcStateMembership(root, key, value, proofBytes))
}

func TestVerifyIbcStateNonMembership_JSONProof(t *testing.T) {
	key := []byte("connections/connection-0")

	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[0:8])

	path := make([]*ics23.InnerOp, 0, 64)
	for depth := 0; depth < 64; depth++ {
		sib := sha256.Sum256([]byte(fmt.Sprintf("sib-nonexist-%d", depth)))
		bit := (index >> uint(depth)) & 1

		if bit == 0 {
			path = append(path, &ics23.InnerOp{
				Hash:   ics23.HashOp_SHA256,
				Prefix: []byte{0x01},
				Suffix: sib[:],
			})
		} else {
			prefix := append([]byte{0x01}, sib[:]...)
			path = append(path, &ics23.InnerOp{
				Hash:   ics23.HashOp_SHA256,
				Prefix: prefix,
				Suffix: []byte{},
			})
		}
	}

	root, err := computeRootFromProofPath(key, []byte{}, path)
	require.NoError(t, err)

	proofBytes := mustJSONNonExistenceProof(t, key, path)

	require.NoError(t, VerifyIbcStateNonMembership(root, key, proofBytes))
}

func mustJSONExistenceProof(t *testing.T, key []byte, value []byte, path []*ics23.InnerOp) []byte {
	t.Helper()

	type jsonInnerOp struct {
		Prefix string `json:"prefix"`
		Suffix string `json:"suffix"`
	}
	type jsonExist struct {
		Key   string        `json:"key"`
		Value string        `json:"value"`
		Path  []jsonInnerOp `json:"path"`
	}
	type jsonProof struct {
		Exist *jsonExist `json:"exist,omitempty"`
	}
	type jsonMerkleProof struct {
		Proofs []jsonProof `json:"proofs"`
	}

	ops := make([]jsonInnerOp, 0, len(path))
	for _, op := range path {
		ops = append(ops, jsonInnerOp{
			Prefix: hex.EncodeToString(op.Prefix),
			Suffix: hex.EncodeToString(op.Suffix),
		})
	}

	mp := jsonMerkleProof{
		Proofs: []jsonProof{
			{
				Exist: &jsonExist{
					Key:   hex.EncodeToString(key),
					Value: hex.EncodeToString(value),
					Path:  ops,
				},
			},
		},
	}

	bz, err := json.Marshal(mp)
	require.NoError(t, err)
	return bz
}

func mustJSONNonExistenceProof(t *testing.T, key []byte, path []*ics23.InnerOp) []byte {
	t.Helper()

	type jsonInnerOp struct {
		Prefix string `json:"prefix"`
		Suffix string `json:"suffix"`
	}
	type jsonExist struct {
		Key   string        `json:"key"`
		Value string        `json:"value"`
		Path  []jsonInnerOp `json:"path"`
	}
	type jsonNonexist struct {
		Key  string     `json:"key"`
		Left *jsonExist `json:"left"`
	}
	type jsonProof struct {
		Nonexist *jsonNonexist `json:"nonexist,omitempty"`
	}
	type jsonMerkleProof struct {
		Proofs []jsonProof `json:"proofs"`
	}

	ops := make([]jsonInnerOp, 0, len(path))
	for _, op := range path {
		ops = append(ops, jsonInnerOp{
			Prefix: hex.EncodeToString(op.Prefix),
			Suffix: hex.EncodeToString(op.Suffix),
		})
	}

	mp := jsonMerkleProof{
		Proofs: []jsonProof{
			{
				Nonexist: &jsonNonexist{
					Key: hex.EncodeToString(key),
					Left: &jsonExist{
						Key:   hex.EncodeToString(key),
						Value: "",
						Path:  ops,
					},
				},
			},
		},
	}

	bz, err := json.Marshal(mp)
	require.NoError(t, err)
	return bz
}
