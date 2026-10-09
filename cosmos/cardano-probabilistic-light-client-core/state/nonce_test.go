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

func TestNonceBootstrapRequiresExplicitStateAndConfiguration(t *testing.T) {
	for _, mutate := range []func(*ClientState){
		func(cs *ClientState) { cs.LatestCheckpointNonceState = nil },
		func(cs *ClientState) { cs.RandomnessStabilisationWindowSlots = 0 },
		func(cs *ClientState) { cs.LatestCheckpointNonceState.EvolvingNonce = []byte{1} },
		func(cs *ClientState) { cs.LatestCheckpointNonceState.EpochNonce[0] ^= 1 },
	} {
		cs := newProbabilisticTestClientState()
		mutate(cs)
		ctx, store := newProbabilisticTestClientStore(t, "nonce-bootstrap")
		require.Error(t, cs.Initialize(ctx, newProbabilisticTestCodec(), store, newProbabilisticTestConsensusState(testBlockHash("bootstrap"))))
	}
	state := testNonceState(bytes.Repeat([]byte{1}, 32))
	state.LastEpochBlockNonce = nil // Explicitly represented native NeutralNonce.
	require.NoError(t, validatePraosNonceState(state))
}

func TestWrongNonceDoesNotQualifyAsMisbehaviour(t *testing.T) {
	cs := newProbabilisticTestClientState()
	ctx, store := newProbabilisticTestClientStore(t, "nonce-misbehaviour")
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(cs.EpochContexts[0])
	header.NewEpochContext.EpochNonce[0] ^= 1
	require.False(t, cs.CheckForMisbehaviour(ctx, newProbabilisticTestCodec(), store, header))
	other := newVerifiedTestHeader(t)
	other.NewEpochContext = cloneEpochContext(cs.EpochContexts[0])
	require.False(t, headersEpochContextConflict(header, other))
	require.True(t, cs.FrozenHeight.IsZero())
}

func TestRecoveryRejectsNonceStateAtTheWrongCheckpoint(t *testing.T) {
	ctx, subjectStore := newProbabilisticTestClientStore(t, "nonce-recovery-subject")
	_, substituteStore := newProbabilisticTestClientStore(t, "nonce-recovery-substitute")
	cs := newProbabilisticTestClientState()
	setTestCheckpoint(t, cs, cs.LatestHeight, testBlockHash("subject"), cs.CurrentEpoch, 10)
	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	setTestCheckpoint(t, substitute, substitute.LatestHeight, testBlockHash("substitute"), substitute.CurrentEpoch, 20)
	consensus := newProbabilisticTestConsensusState(substitute.LatestCheckpointBlockHash, 20)
	consensus.Timestamp = substitute.LatestCheckpointTimestamp
	consensus.NonceState.CandidateNonce[0] ^= 1
	cdc := newProbabilisticTestCodec()
	SetConsensusState(substituteStore, cdc, consensus, substitute.LatestHeight)
	require.ErrorContains(t, cs.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute), "nonce state does not match")
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
		epoch: block.Epoch, blockHash: prevHash, nonceState: testNonceState(contexts[0].EpochNonce)}
}

func testNonceTracker(t testing.TB, block *ProbabilisticBlock, contexts []*EpochContext) *nonceTracker {
	t.Helper()
	tracker, err := newNonceTracker(testHeaderTrustedNonceState(t, &ProbabilisticHeader{AnchorBlock: block}, contexts))
	require.NoError(t, err)
	return tracker
}
