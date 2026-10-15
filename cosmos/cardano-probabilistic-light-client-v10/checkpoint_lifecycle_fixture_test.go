package probabilistic

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	transfer "github.com/cosmos/ibc-go/v10/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

type idleCheckpointHistoryData struct {
	Client                   *ClientState
	Consensus                *ConsensusState
	Honest, Bad, Tail, Later struct {
		Blocks   []*ProbabilisticBlock
		Contexts []*EpochContext
	}
}

func idleCheckpointAddress() sdk.AccAddress {
	return sdk.AccAddress(secp256k1.GenPrivKeyFromSecret([]byte("caribic-v8-acceptance/operator")).PubKey().Address())
}
func idleCheckpointHistory(t *testing.T) idleCheckpointHistoryData {
	t.Helper()
	var history idleCheckpointHistoryData
	require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-idle.json.gz"), &history))
	delta := time.Now().Add(-5*time.Minute).UnixNano() - int64(history.Honest.Blocks[len(history.Honest.Blocks)-1].Timestamp)
	history.Client.SystemStartUnixNs = uint64(int64(history.Client.SystemStartUnixNs) + delta)
	history.Client.LatestCheckpointTimestamp = uint64(int64(history.Client.LatestCheckpointTimestamp) + delta)
	history.Consensus.Timestamp = uint64(int64(history.Consensus.Timestamp) + delta)
	for _, blocks := range [][]*ProbabilisticBlock{history.Honest.Blocks, history.Bad.Blocks, history.Tail.Blocks, history.Later.Blocks} {
		for _, block := range blocks {
			block.Timestamp = uint64(int64(block.Timestamp) + delta)
		}
	}
	return history
}
func idleCheckpointProof(t *testing.T, values map[string][]byte, key string) ([]byte, []byte) {
	t.Helper()
	levels := make([]map[uint64][]byte, 65)
	levels[0] = map[uint64][]byte{}
	zero := make([]byte, 32)
	for k, v := range values {
		kh, vh := sha256.Sum256([]byte(k)), sha256.Sum256(v)
		leaf := sha256.Sum256(append(append([]byte{0}, kh[:]...), vh[:]...))
		index := binary.BigEndian.Uint64(kh[:8])
		require.Nil(t, levels[0][index], "fixture keys collide")
		levels[0][index] = leaf[:]
	}
	get := func(depth int, index uint64) []byte {
		if v := levels[depth][index]; v != nil {
			return v
		}
		return zero
	}
	for depth := 0; depth < 64; depth++ {
		levels[depth+1] = map[uint64][]byte{}
		for index := range levels[depth] {
			parent := index >> 1
			left, right := get(depth, parent<<1), get(depth, parent<<1|1)
			hash := sha256.Sum256(append(append([]byte{1}, left...), right...))
			levels[depth+1][parent] = hash[:]
		}
	}
	kh := sha256.Sum256([]byte(key))
	index := binary.BigEndian.Uint64(kh[:8])
	path := []*ics23.InnerOp{}
	for depth := 0; depth < 64; depth++ {
		sibling := get(depth, index^1)
		op := &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: []byte{1}}
		if index&1 == 0 {
			op.Suffix = sibling
		} else {
			op.Prefix = append(op.Prefix, sibling...)
		}
		path = append(path, op)
		index >>= 1
	}
	existence := &ics23.ExistenceProof{Key: []byte(key), Value: values[key], Path: path}
	proof := &ics23.CommitmentProof{Proof: &ics23.CommitmentProof_Exist{Exist: existence}}
	if len(values[key]) == 0 {
		proof = &ics23.CommitmentProof{Proof: &ics23.CommitmentProof_Nonexist{Nonexist: &ics23.NonExistenceProof{Key: []byte(key), Left: existence}}}
	}
	encoded, err := (&commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{proof}}).Marshal()
	require.NoError(t, err)
	root := get(64, 0)
	calculated, err := core.ComputeRootFromProofPath([]byte(key), values[key], path)
	require.NoError(t, err)
	require.Equal(t, root, calculated)
	return encoded, root
}

func idleCheckpointPacket(sequence uint64) channeltypes.Packet {
	return idleCheckpointPacketForReceiver(sequence, idleCheckpointAddress().String())
}

func idleCheckpointPacketForReceiver(sequence uint64, receiver string) channeltypes.Packet {
	data := transfer.NewFungibleTokenPacketData("lovelace", "100", "cardano-local-sender", receiver, "").GetBytes()
	return channeltypes.NewPacket(data, sequence, "transfer", "channel-0", "transfer", "channel-0", clienttypes.ZeroHeight(), uint64(time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC).UnixNano()))
}

func idleCheckpointCommitmentKey(sequence uint64) string {
	return fmt.Sprintf("commitments/ports/transfer/channels/channel-0/sequences/%d", sequence)
}

func idleCheckpointLaneValues(t *testing.T, count uint64) map[string][]byte {
	return idleCheckpointLaneValuesForReceiver(t, count, idleCheckpointAddress().String())
}

func idleCheckpointLaneValuesForReceiver(t *testing.T, count uint64, receiver string) map[string][]byte {
	t.Helper()
	values := map[string][]byte{}
	for n := uint64(1); n <= count; n++ {
		values[idleCheckpointCommitmentKey(n)] = channeltypes.CommitPacket(idleCheckpointPacketForReceiver(n, receiver))
	}
	return values
}

func idleCheckpointHeader(t *testing.T, history idleCheckpointHistoryData, branch string, trusted, anchor uint64) *ProbabilisticHeader {
	return idleCheckpointSourceHeader(t, history, branch, trusted, anchor, false)
}

func idleCheckpointSourceHeader(t *testing.T, history idleCheckpointHistoryData, branch string, trusted, anchor uint64, checkpoint bool) *ProbabilisticHeader {
	t.Helper()
	blocks, contexts := history.Honest.Blocks, history.Honest.Contexts
	if branch == "bad" {
		blocks, contexts = history.Bad.Blocks, history.Bad.Contexts
	}
	if branch == "tail" {
		blocks, contexts = history.Tail.Blocks, history.Tail.Contexts
	}
	if branch == "later" {
		blocks, contexts = history.Later.Blocks, history.Later.Contexts
	}
	h := &ProbabilisticHeader{TrustedHeight: NewHeight(0, trusted), IsCheckpoint: checkpoint}
	for _, b := range blocks {
		if b.Height.RevisionHeight <= trusted || b.Height.RevisionHeight > anchor+30 {
			continue
		}
		copy := cloneTestProbabilisticBlock(b)
		if b.Height.RevisionHeight < anchor {
			h.BridgeBlocks = append(h.BridgeBlocks, copy)
		} else if b.Height.RevisionHeight == anchor {
			h.AnchorBlock = copy
			if checkpoint {
				continue
			}
			block, err := core.DecodeLedgerBlock(b.BlockCbor)
			require.NoError(t, err)
			require.Len(t, block.Transactions(), 1)
			h.HostStateTxHash = block.Transactions()[0].Hash().String()
		} else {
			h.DescendantBlocks = append(h.DescendantBlocks, copy)
		}
	}
	trustedEpoch := uint64(7)
	if trusted >= 1001 {
		trustedEpoch = 8
	}
	if trusted >= 1094 {
		trustedEpoch = 9
	}
	if h.AnchorBlock.Epoch > trustedEpoch {
		for _, c := range contexts {
			if c.Epoch == h.AnchorBlock.Epoch {
				h.NewEpochContext = fromCoreEpochContext(toCoreEpochContext(c))
			}
		}
	}
	require.NoError(t, h.ValidateBasic())
	return h
}
