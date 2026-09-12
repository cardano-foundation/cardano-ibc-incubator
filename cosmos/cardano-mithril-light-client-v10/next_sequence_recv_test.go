package mithril

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

type nextSequenceRecvVector struct {
	Sequence  string
	Committed string
	Expected  string
	Root      string
}

type nextSequenceRecvFixture struct {
	Version   int
	Key       string
	ProofPath []struct {
		Prefix string `json:"prefix"`
		Suffix string `json:"suffix"`
	}
	Vectors []nextSequenceRecvVector
}

func loadNextSequenceRecvFixture(t *testing.T) nextSequenceRecvFixture {
	t.Helper()
	data, err := os.ReadFile("../../tests/ibc-state-commitment/next-sequence-recv.json")
	require.NoError(t, err)
	var fixture nextSequenceRecvFixture
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Equal(t, 1, fixture.Version)
	require.Len(t, fixture.ProofPath, 64)
	require.NotEmpty(t, fixture.Vectors)
	return fixture
}

func nextSequenceRecvHex(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	require.NoError(t, err)
	return decoded
}

func nextSequenceRecvProof(t *testing.T, fixture nextSequenceRecvFixture, vector nextSequenceRecvVector) []byte {
	t.Helper()
	exist := &ics23.ExistenceProof{
		Key: []byte(fixture.Key), Value: nextSequenceRecvHex(t, vector.Committed),
	}
	for _, op := range fixture.ProofPath {
		exist.Path = append(exist.Path, &ics23.InnerOp{
			Hash:   ics23.HashOp_SHA256,
			Prefix: nextSequenceRecvHex(t, op.Prefix), Suffix: nextSequenceRecvHex(t, op.Suffix),
		})
	}
	proof := commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{{
		Proof: &ics23.CommitmentProof_Exist{Exist: exist},
	}}}
	encoded, err := proof.Marshal()
	require.NoError(t, err)
	return encoded
}

func TestNextSequenceRecvGatewayProofs(t *testing.T) {
	fixture := loadNextSequenceRecvFixture(t)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Sequence, func(t *testing.T) {
			legacyProof, err := json.Marshal(map[string]any{"proofs": []any{
				map[string]any{"exist": map[string]any{
					"key":   hex.EncodeToString([]byte(fixture.Key)),
					"value": vector.Committed, "path": fixture.ProofPath,
				}},
			}})
			require.NoError(t, err)
			for encoding, proof := range map[string][]byte{
				"protobuf": nextSequenceRecvProof(t, fixture, vector), "json": legacyProof,
			} {
				t.Run(encoding, func(t *testing.T) {
					root := nextSequenceRecvHex(t, vector.Root)
					expected := nextSequenceRecvHex(t, vector.Expected)
					key := []byte(fixture.Key)
					require.NoError(t, VerifyIbcStateMembership(root, key, expected, proof))
					expected[7] ^= 1
					require.ErrorContains(t, VerifyIbcStateMembership(root, key, expected, proof), "value mismatch")
					expected[7] ^= 1
					root[0] ^= 1
					require.ErrorContains(t, VerifyIbcStateMembership(root, key, expected, proof), "ibc_state_root")
					root[0] ^= 1
					require.ErrorContains(t, VerifyIbcStateMembership(root, []byte(fixture.Key+"0"), expected, proof), "key mismatch")
				})
			}
		})
	}
}

func TestNextSequenceRecvRejectsInvalidEncoding(t *testing.T) {
	key := []byte("nextSequenceRecv/ports/mock/channels/channel-0")
	expected := []byte{0, 0, 0, 0, 0, 0, 0, 1}
	for name, committed := range map[string]string{
		"empty": "", "negative": "20", "bytestring": "480000000000000001",
		"text": "6131", "float": "f93c00", "boolean": "f5",
		"bignum overflow": "c249010000000000000000", "truncated": "1b01", "trailing data": "0100",
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, verifyCardanoValueMatchesExpected(key, expected, nextSequenceRecvHex(t, committed)))
		})
	}
	for _, committed := range []byte{0xf6, 0xf7} {
		require.Error(t, verifyCardanoValueMatchesExpected(key, make([]byte, 8), []byte{committed}))
	}
	for _, length := range []int{0, 1, 7, 9} {
		require.Error(t, verifyCardanoValueMatchesExpected(key, make([]byte, length), []byte{0}))
	}
}
