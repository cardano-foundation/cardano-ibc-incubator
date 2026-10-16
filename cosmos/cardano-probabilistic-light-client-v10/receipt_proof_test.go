package probabilistic

import (
	"crypto/sha256"
	"encoding/binary"
	"testing"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestReceiptMembershipUnsupported(t *testing.T) {
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/7")
	path := receiptProofPath(key)
	// Aiken and the Gateway commit CBOR's empty bytestring, not ibc-go's 0x01.
	committed := []byte{0x40}
	root, err := probabilisticcore.ComputeRootFromProofPath(key, committed, path)
	require.NoError(t, err)
	proof := &ics23.ExistenceProof{Key: key, Value: committed, Path: path}

	for _, tc := range []struct {
		name     string
		expected []byte
	}{
		{"ibc-go sentinel", []byte{0x01}},
		{"empty receipt", []byte{}},
		{"committed CBOR bytes", committed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proofBytes := marshalReceiptProof(t, &ics23.CommitmentProof{
				Proof: &ics23.CommitmentProof_Exist{Exist: proof},
			})
			require.EqualError(t, VerifyIbcStateMembership(root, key, tc.expected, proofBytes),
				"packet receipt membership is unsupported: only non-membership proofs are supported")
		})
	}
}

func TestReceiptNonMembership(t *testing.T) {
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/7")
	path := receiptProofPath(key)
	absentRoot, err := probabilisticcore.ComputeRootFromProofPath(key, nil, path)
	require.NoError(t, err)
	receivedRoot, err := probabilisticcore.ComputeRootFromProofPath(key, []byte{0x40}, path)
	require.NoError(t, err)
	require.NotEqual(t, absentRoot, receivedRoot)

	nonexist := &ics23.NonExistenceProof{
		Key:  key,
		Left: &ics23.ExistenceProof{Key: key, Path: path},
	}
	proofBytes := marshalReceiptProof(t, &ics23.CommitmentProof{
		Proof: &ics23.CommitmentProof_Nonexist{Nonexist: nonexist},
	})
	require.NoError(t, VerifyIbcStateNonMembership(absentRoot, key, proofBytes))
	// An empty leaf cannot prove absence under a root containing a receipt.
	require.ErrorContains(t, VerifyIbcStateNonMembership(receivedRoot, key, proofBytes),
		"proof does not match ibc_state_root")

	// Nor can the CBOR empty receipt be passed off as an absent leaf.
	nonexist.Left.Value = []byte{0x40}
	proofBytes = marshalReceiptProof(t, &ics23.CommitmentProof{
		Proof: &ics23.CommitmentProof_Nonexist{Nonexist: nonexist},
	})
	require.ErrorContains(t, VerifyIbcStateNonMembership(receivedRoot, key, proofBytes),
		"non-existence proof left value must be empty")
}

func receiptProofPath(key []byte) []*ics23.InnerOp {
	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[:8])
	path := make([]*ics23.InnerOp, 64)
	for depth := range path {
		sibling := make([]byte, 32)
		op := &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: []byte{0x01}}
		if (index>>uint(depth))&1 == 0 {
			op.Suffix = sibling
		} else {
			op.Prefix = append(op.Prefix, sibling...)
		}
		path[depth] = op
	}
	return path
}

func marshalReceiptProof(t *testing.T, proof *ics23.CommitmentProof) []byte {
	t.Helper()
	mp := commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{proof}}
	proofBytes, err := mp.Marshal()
	require.NoError(t, err)
	return proofBytes
}
