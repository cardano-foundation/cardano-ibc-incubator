package probabilistic

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	pathTypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types/v2"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
	"os"
	"strings"
	"testing"
)

func packetProofFixture(t *testing.T, key, value []byte) (*ics23.ExistenceProof, []byte) {
	t.Helper()
	hash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(hash[:8])
	path := make([]*ics23.InnerOp, 64)
	for depth := range path {
		if index>>uint(depth)&1 == 0 {
			path[depth] = &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: []byte{1}, Suffix: make([]byte, 32)}
		} else {
			path[depth] = &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: append([]byte{1}, make([]byte, 32)...)}
		}
	}
	root, err := probabilisticcore.ComputeRootFromProofPath(key, value, path)
	require.NoError(t, err)
	return &ics23.ExistenceProof{Key: key, Value: value, Path: path}, root
}

func TestDefaultPacketProofsUseAuthenticatedLaneSnapshot(t *testing.T) {
	text, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/gateway-packet-snapshot.hex")
	require.NoError(t, err)
	raw, err := hex.DecodeString(strings.TrimSpace(string(text)))
	require.NoError(t, err)
	snapshot, err := probabilisticcore.DecodePacketStateSnapshot(raw)
	require.NoError(t, err)
	consensus := newProbabilisticTestConsensusState(snapshot.BlockHash, snapshot.Height)
	consensus.IbcStateRoot = snapshot.HostRoot
	consensus.PacketStateSnapshot = raw
	client := newProbabilisticTestClientState()
	client.EpochContextChallenges = []*EpochContextChallenge{{Epoch: 7, UsableAfterUnixNs: 1}}
	ctx, store := newProbabilisticTestClientStore(t, "packet-lane-proofs")
	cdc := newProbabilisticTestCodec()
	height := NewHeight(0, 42)
	setConsensusState(store, cdc, consensus, height)
	setConsensusMetadata(ctx, store, height)
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/1")
	empty, _ := packetProofFixture(t, key, nil)
	absence := commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{{Proof: &ics23.CommitmentProof_Nonexist{Nonexist: &ics23.NonExistenceProof{Key: key, Left: empty}}}}}
	proof, err := absence.Marshal()
	require.NoError(t, err)
	require.NoError(t, client.VerifyNonMembership(ctx, store, cdc, height, 0, 0, proof, pathTypes.NewMerklePath([]byte("ibc"), key)))
	require.Error(t, verifyPacketNonMembership(consensus, 43, key, proof))

	key = []byte("commitments/ports/transfer/channels/channel-0/sequences/2")
	value := bytes.Repeat([]byte{0xab}, 32)
	existence, root := packetProofFixture(t, key, value)
	name, err := probabilisticcore.PacketLaneTokenName("transfer", "channel-0", 0, 2)
	require.NoError(t, err)
	lane := snapshot.Lanes[hex.EncodeToString(name)]
	lane.State.Root = root
	lane.State.Version = 1
	snapshot.Lanes[hex.EncodeToString(name)] = lane
	consensus.PacketStateSnapshot, err = probabilisticcore.EncodePacketStateSnapshot(snapshot)
	require.NoError(t, err)
	setConsensusState(store, cdc, consensus, height)
	membership := commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{{Proof: &ics23.CommitmentProof_Exist{Exist: existence}}}}
	proof, err = membership.Marshal()
	require.NoError(t, err)
	require.NoError(t, client.VerifyMembership(ctx, store, cdc, height, 0, 0, proof, pathTypes.NewMerklePath([]byte("ibc"), key), value))
	require.Error(t, client.VerifyMembership(ctx, store, cdc, height, 0, 0, proof, pathTypes.NewMerklePath([]byte("ibc"), key), []byte{1}))
	require.Error(t, client.VerifyMembership(ctx, store, cdc, height, 0, 0, proof, pathTypes.NewMerklePath([]byte("ibc"), []byte("commitments/ports/transfer/channels/channel-1/sequences/2")), value))
	require.False(t, isPacketStateKey([]byte("commitments/ports/mock/channels/channel-0/sequences/2")))
}
