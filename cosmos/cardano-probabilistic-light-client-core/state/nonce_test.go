package state

import (
	"bytes"
	"math"
	"testing"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/stretchr/testify/require"
)

// Explicit synthetic checkpoint state for tests unrelated to nonce evolution.
func testNonceState(epochNonce []byte) *PraosNonceState {
	return &PraosNonceState{EpochNonce: bytes.Clone(epochNonce),
		EvolvingNonce: bytes.Repeat([]byte{0x41}, 32), CandidateNonce: bytes.Repeat([]byte{0x42}, 32),
		LastAppliedBlockNonce: bytes.Repeat([]byte{0x43}, 32), LastEpochBlockNonce: bytes.Repeat([]byte{0x44}, 32)}
}

func TestNonceCutoffAndRollover(t *testing.T) {
	cs := &ClientState{CurrentEpochEndSlotExclusive: 120, RandomnessStabilisationWindowSlots: 24}
	for _, slot := range []uint64{95, 96, 97} {
		tracker := &nonceTracker{state: testNonceState(bytes.Repeat([]byte{1}, 32))}
		before := clonePraosNonceState(tracker.state)
		block := &authenticatedProbabilisticBlock{height: 1, slot: slot, hash: testBlockHash("own"), prevHash: testBlockHash("parent")}
		require.NoError(t, tracker.apply(cs, block, bytes.Repeat([]byte{2}, 64)))
		require.NotEqual(t, before.EvolvingNonce, tracker.state.EvolvingNonce)
		if slot == 95 {
			require.Equal(t, tracker.state.EvolvingNonce, tracker.state.CandidateNonce)
		} else {
			require.Equal(t, before.CandidateNonce, tracker.state.CandidateNonce)
		}
		parent, err := core.PraosPreviousHashNonce(block.prevHash)
		require.NoError(t, err)
		require.Equal(t, parent, tracker.state.LastAppliedBlockNonce)
		before = clonePraosNonceState(tracker.state)
		expectedNonce, err := core.CombinePraosNonces(before.CandidateNonce, before.LastEpochBlockNonce)
		require.NoError(t, err)
		require.NoError(t, tracker.tick(cs, 2, 120, 1, block.hash))
		require.Equal(t, expectedNonce, tracker.state.EpochNonce)
		require.Equal(t, before.LastAppliedBlockNonce, tracker.state.LastEpochBlockNonce)
		require.Equal(t, before.EvolvingNonce, tracker.state.EvolvingNonce)
		require.NoError(t, tracker.apply(cs, &authenticatedProbabilisticBlock{height: 2, epoch: 1, slot: 120, prevHash: block.hash}, bytes.Repeat([]byte{3}, 64)))
		require.Equal(t, tracker.state.EvolvingNonce, tracker.state.CandidateNonce)
	}
}

func TestNonceCutoffRejectsOverflow(t *testing.T) {
	cs := &ClientState{CurrentEpochEndSlotExclusive: math.MaxUint64, RandomnessStabilisationWindowSlots: 24}
	tracker := &nonceTracker{state: testNonceState(bytes.Repeat([]byte{1}, 32))}
	before := clonePraosNonceState(tracker.state)
	require.ErrorContains(t, tracker.apply(cs, &authenticatedProbabilisticBlock{slot: math.MaxUint64 - 1}, make([]byte, 64)), "overflows")
	require.Equal(t, before, tracker.state)
}

func testHeaderTrustedNonceState(t testing.TB, header *ProbabilisticHeader, contexts []*EpochContext) *trustedBlockState {
	t.Helper()
	block := header.AnchorBlock
	if len(header.BridgeBlocks) > 0 {
		block = header.BridgeBlocks[0]
	}
	prevHash := ""
	if len(block.BlockCbor) > 0 {
		decoded, err := decodeLedgerBlock(block.BlockCbor)
		require.NoError(t, err)
		prevHash, err = blockPrevHash(decoded)
		require.NoError(t, err)
	} else {
		decoded, err := core.DecodeLedgerHeader(block.HeaderCbor)
		require.NoError(t, err)
		prevHash = core.HeaderPrevHash(decoded)
	}
	return &trustedBlockState{height: NewHeight(0, block.Height.RevisionHeight-1), slot: block.Slot - 1,
		epoch: block.Epoch, blockHash: prevHash, nonceState: testNonceState(contexts[0].EpochNonce), poolRegistry: testPoolRegistry(block.Epoch, contexts[0].StakeDistribution)}
}

func testNonceTracker(t testing.TB, block *ProbabilisticBlock, contexts []*EpochContext) *nonceTracker {
	t.Helper()
	tracker, err := newNonceTracker(testHeaderTrustedNonceState(t, &ProbabilisticHeader{AnchorBlock: block}, contexts))
	require.NoError(t, err)
	return tracker
}
