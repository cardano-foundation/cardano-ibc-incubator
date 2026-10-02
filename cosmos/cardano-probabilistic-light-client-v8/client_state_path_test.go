package probabilistic

import (
	"crypto/sha256"
	"encoding/binary"
	"testing"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestIbcStateKeyFromPath(t *testing.T) {
	for _, key := range []string{
		"clients/07-tendermint-0/clientState",
		"connections/connection-0",
		"channelEnds/ports/transfer/channels/channel-0",
		"commitments/ports/transfer/channels/channel-0/sequences/1",
		"acks/ports/transfer/channels/channel-0/sequences/1",
		"receipts/ports/transfer/channels/channel-0/sequences/1",
		"nextSequenceRecv/ports/transfer/channels/channel-0",
	} {
		t.Run(key, func(t *testing.T) {
			// Build the complete path exactly as ibc-go's connection keeper does.
			objectPath := commitmenttypes.NewMerklePath()
			objectPath.KeyPath = proofTestPathKeys(objectPath.KeyPath, key)
			path, err := commitmenttypes.ApplyPrefix(
				commitmenttypes.NewMerklePrefix([]byte("ibc")),
				objectPath,
			)
			require.NoError(t, err)
			got, err := ibcStateKeyFromPath(path)
			require.NoError(t, err)
			require.Equal(t, []byte(key), got)
		})
	}

	t.Run("consensus height translation", func(t *testing.T) {
		key, err := ibcStateKeyFromPath(proofTestPath("ibc", "clients/07-tendermint-0/consensusStates/0-42"))
		require.NoError(t, err)
		require.Equal(t, []byte("clients/07-tendermint-0/consensusStates/42"), key)
	})

	for name, path := range invalidProofTestPaths("connections/connection-0") {
		t.Run(name, func(t *testing.T) {
			key, err := ibcStateKeyFromPath(path)
			require.Error(t, err)
			require.Nil(t, key)
		})
	}
}

func TestClientStateProofPathNamespace(t *testing.T) {
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/1")
	for _, membership := range []bool{true, false} {
		name := "non-membership"
		if membership {
			name = "membership"
		}
		t.Run(name, func(t *testing.T) {
			// Construct a valid Cardano proof and reuse it for every path alias.
			root, proof := proofTestReceipt(t, key, membership)
			ctx, clientStore := newProbabilisticTestClientStore(t, "proof-path")
			cdc := newProbabilisticTestCodec()
			height := clienttypes.NewHeight(0, 10)
			setConsensusState(clientStore, cdc, &ConsensusState{IbcStateRoot: root}, height)
			setConsensusMetadata(ctx, clientStore, height)
			cs := ClientState{}
			verify := func(path exported.Path) error {
				if membership {
					return cs.VerifyMembership(ctx, clientStore, cdc, height, 0, 0, proof, path, []byte{0x01})
				}
				return cs.VerifyNonMembership(ctx, clientStore, cdc, height, 0, 0, proof, path)
			}

			require.NoError(t, verify(proofTestPath("ibc", string(key))))
			for name, path := range invalidProofTestPaths(string(key)) {
				t.Run(name, func(t *testing.T) {
					require.ErrorIs(t, verify(path), clienttypes.ErrFailedMembershipVerification)
				})
			}
		})
	}
}

func invalidProofTestPaths(key string) map[string]exported.Path {
	return map[string]exported.Path{
		"nil path":                nil,
		"empty path":              proofTestPath(),
		"missing prefix":          proofTestPath(key),
		"prefix only":             proofTestPath("ibc"),
		"wrong prefix":            proofTestPath("wrong-prefix", key),
		"empty prefix":            proofTestPath("", key),
		"case changed prefix":     proofTestPath("IBC", key),
		"prefix with slash":       proofTestPath("ibc/", key),
		"prefix with null byte":   proofTestPath("ibc\x00", key),
		"extra leading component": proofTestPath("extra", "ibc", key),
		"extra and wrong prefix":  proofTestPath("extra", "wrong-prefix", key),
		"extra middle component":  proofTestPath("ibc", "extra", key),
		"empty key":               proofTestPath("ibc", ""),
	}
}

func proofTestPath(keys ...string) exported.Path {
	path := commitmenttypes.NewMerklePath()
	path.KeyPath = proofTestPathKeys(path.KeyPath, keys...)
	return path
}

// The adapters use string keys in ibc-go v8 and byte slices in v10.
func proofTestPathKeys[T ~string | ~[]byte](path []T, keys ...string) []T {
	for _, key := range keys {
		path = append(path, T(key))
	}
	return path
}

func proofTestReceipt(t *testing.T, key []byte, membership bool) ([]byte, []byte) {
	t.Helper()
	var value []byte
	if membership {
		value = []byte{0x41, 0x01} // CBOR bytestring encoding of a packet receipt.
	}
	keyHash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(keyHash[:8])
	path := make([]*ics23.InnerOp, 64)
	for depth := range path {
		sibling := make([]byte, 32)
		if (index>>uint(depth))&1 == 0 {
			path[depth] = &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: []byte{0x01}, Suffix: sibling}
		} else {
			path[depth] = &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: append([]byte{0x01}, sibling...)}
		}
	}
	root, err := probabilisticcore.ComputeRootFromProofPath(key, value, path)
	require.NoError(t, err)
	exist := &ics23.ExistenceProof{Key: key, Value: value, Path: path}
	commitment := &ics23.CommitmentProof{}
	if membership {
		commitment.Proof = &ics23.CommitmentProof_Exist{Exist: exist}
	} else {
		commitment.Proof = &ics23.CommitmentProof_Nonexist{
			Nonexist: &ics23.NonExistenceProof{Key: key, Left: exist},
		}
	}
	merkleProof := commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{commitment}}
	proof, err := merkleProof.Marshal()
	require.NoError(t, err)
	return root, proof
}
