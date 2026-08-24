package probabilistic

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"
)

func TestVerifyHeaderTemporalContinuityRejectsNonIncreasingSlots(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	ctx := temporalTestContext(t, clientState, 140)

	testCases := []struct {
		name   string
		mutate func(*authenticatedProbabilisticHeader, uint64)
	}{
		{
			name: "trusted to first bridge",
			mutate: func(header *authenticatedProbabilisticHeader, slot uint64) {
				setAuthenticatedTestSlot(t, clientState, header.bridgeBlocks[0], slot)
			},
		},
		{
			name: "bridge to bridge",
			mutate: func(header *authenticatedProbabilisticHeader, slot uint64) {
				setAuthenticatedTestSlot(t, clientState, header.bridgeBlocks[1], slot+10)
			},
		},
		{
			name: "last bridge to anchor",
			mutate: func(header *authenticatedProbabilisticHeader, slot uint64) {
				setAuthenticatedTestSlot(t, clientState, header.anchorBlock, slot+20)
			},
		},
		{
			name: "trusted directly to anchor",
			mutate: func(header *authenticatedProbabilisticHeader, slot uint64) {
				header.bridgeBlocks = nil
				setAuthenticatedTestSlot(t, clientState, header.anchorBlock, slot)
			},
		},
		{
			name: "anchor to first descendant",
			mutate: func(header *authenticatedProbabilisticHeader, slot uint64) {
				setAuthenticatedTestSlot(t, clientState, header.descendantBlocks[0], slot+30)
			},
		},
		{
			name: "descendant to descendant",
			mutate: func(header *authenticatedProbabilisticHeader, slot uint64) {
				setAuthenticatedTestSlot(t, clientState, header.descendantBlocks[1], slot+40)
			},
		},
	}

	for _, testCase := range testCases {
		for _, delta := range []uint64{0, 1} {
			name := "equal"
			if delta == 1 {
				name = "decreasing"
			}
			t.Run(testCase.name+"/"+name, func(t *testing.T) {
				header, trustedBlock := newTemporalTestHeader(t, clientState)
				testCase.mutate(header, trustedBlock.slot-delta)

				err := clientState.verifyHeaderTemporalContinuity(ctx, header, trustedBlock)
				require.ErrorIs(t, err, ErrInvalidTimestamp)
				require.ErrorContains(t, err, "must be greater than previous authenticated slot")
			})
		}
	}
}

func TestVerifyHeaderTemporalContinuityEnforcesHostTimeForEveryBlockRole(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	clientState.MaxClockDrift = 10 * time.Second
	ctx := temporalTestContext(t, clientState, 140)

	header, trustedBlock := newTemporalTestHeader(t, clientState)
	require.NoError(t, clientState.verifyHeaderTemporalContinuity(ctx, header, trustedBlock))
	require.Equal(t, uint64(150), header.descendantBlocks[1].slot, "the exact drift boundary must be accepted")

	for _, testCase := range []struct {
		name   string
		mutate func(*authenticatedProbabilisticHeader)
	}{
		{
			name: "future bridge",
			mutate: func(header *authenticatedProbabilisticHeader) {
				setAuthenticatedTestSlot(t, clientState, header.bridgeBlocks[0], 151)
			},
		},
		{
			name: "future anchor",
			mutate: func(header *authenticatedProbabilisticHeader) {
				setAuthenticatedTestSlot(t, clientState, header.anchorBlock, 151)
			},
		},
		{
			name: "future descendant",
			mutate: func(header *authenticatedProbabilisticHeader) {
				setAuthenticatedTestSlot(t, clientState, header.descendantBlocks[0], 151)
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			header, trustedBlock := newTemporalTestHeader(t, clientState)
			testCase.mutate(header)

			err := clientState.verifyHeaderTemporalContinuity(ctx, header, trustedBlock)
			require.ErrorIs(t, err, ErrInvalidTimestamp)
			require.ErrorContains(t, err, "exceeds Cosmos host time plus max clock drift")
		})
	}
}

func TestVerifyHeaderPathEnforcesTemporalContinuityAcrossEpochRollover(t *testing.T) {
	baseEpoch := newTemporalVerifierEpochContext(7, 0, 1_000, 0x07)
	ctx, cdc, clientStore, clientState := initializeTemporalVerifierClient(
		t,
		"probabilistic-temporal-rollover",
		999,
		baseEpoch,
	)
	ctx = temporalTestContext(t, clientState, 1_024)

	nextEpoch := newTemporalVerifierEpochContext(8, 1_000, 2_000, 0x08)
	header := newTemporalVerifierHeader(t, clientState, "rollover-anchor", 11, 1_000, 8, true)
	header.NewEpochContext = cloneEpochContext(nextEpoch)
	authenticated := newTemporalVerifierAuthenticatedHeader(
		t,
		clientState,
		"trusted-10",
		header.AnchorBlock.Hash,
		11,
		1_000,
		8,
	)

	authenticate := func(
		_ *ProbabilisticHeader,
		epochContexts []*EpochContext,
		_ map[string]uint64,
	) (*authenticatedProbabilisticHeader, error) {
		require.NotNil(t, epochContextByEpoch(epochContexts, 7))
		require.NotNil(t, epochContextByEpoch(epochContexts, 8))
		return authenticated, nil
	}
	require.NoError(t, clientState.verifyHeaderWithAuthenticator(ctx, clientStore, cdc, header, authenticate))

	duplicateSlot := newTemporalVerifierAuthenticatedHeader(
		t,
		clientState,
		"trusted-10",
		header.AnchorBlock.Hash,
		11,
		1_000,
		8,
	)
	duplicateSlot.descendantBlocks[0].slot = duplicateSlot.anchorBlock.slot
	duplicateSlot.descendantBlocks[0].timestamp = duplicateSlot.anchorBlock.timestamp
	err := clientState.verifyHeaderWithAuthenticator(
		ctx,
		clientStore,
		cdc,
		header,
		func(*ProbabilisticHeader, []*EpochContext, map[string]uint64) (*authenticatedProbabilisticHeader, error) {
			return duplicateSlot, nil
		},
	)
	require.ErrorIs(t, err, ErrInvalidTimestamp)
	require.ErrorContains(t, err, "must be greater than previous authenticated slot")
}

func TestNormalUpdateVerifierRejectsTemporalViolationsWithoutStoringConsensus(t *testing.T) {
	epochContext := newTemporalVerifierEpochContext(7, 0, 1_000_000, 0x07)
	ctx, cdc, clientStore, clientState := initializeTemporalVerifierClient(
		t,
		"probabilistic-temporal-normal-update",
		100,
		epochContext,
	)
	clientState.MaxClockDrift = 10 * time.Second
	ctx = temporalTestContext(t, clientState, 130)

	for _, testCase := range []struct {
		name       string
		anchorSlot uint64
		want       string
	}{
		{name: "non-increasing anchor", anchorSlot: 100, want: "must be greater than previous authenticated slot"},
		{name: "future anchor", anchorSlot: 141, want: "exceeds Cosmos host time plus max clock drift"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			anchorHash := "rejected-" + testCase.name
			header := newTemporalVerifierHeader(t, clientState, anchorHash, 11, testCase.anchorSlot, 7, false)
			authenticated := newTemporalVerifierAuthenticatedHeader(
				t,
				clientState,
				"trusted-10",
				anchorHash,
				11,
				testCase.anchorSlot,
				7,
			)

			err := clientState.verifyHeaderWithAuthenticator(
				ctx,
				clientStore,
				cdc,
				header,
				func(*ProbabilisticHeader, []*EpochContext, map[string]uint64) (*authenticatedProbabilisticHeader, error) {
					return authenticated, nil
				},
			)
			require.ErrorIs(t, err, ErrInvalidTimestamp)
			require.ErrorContains(t, err, testCase.want)
			_, found := GetConsensusState(clientStore, cdc, header.GetHeight())
			require.False(t, found)
		})
	}
}

func TestStoredConsensusTimestampUsesBoundedAuthenticatedAnchorTime(t *testing.T) {
	epochContext := newTemporalVerifierEpochContext(7, 0, 1_000_000, 0x07)
	ctx, cdc, clientStore, clientState := initializeTemporalVerifierClient(
		t,
		"probabilistic-temporal-stored-consensus",
		100,
		epochContext,
	)
	clientState.MaxClockDrift = 10 * time.Second
	ctx = temporalTestContext(t, clientState, 150)

	authenticated := newTemporalVerifierAuthenticatedHeader(
		t,
		clientState,
		"trusted-10",
		"accepted-11",
		11,
		130,
		7,
	)
	trustedBlock, err := clientState.latestTrustedBlockState(clientStore, cdc)
	require.NoError(t, err)
	require.NoError(t, clientState.verifyHeaderTemporalContinuity(ctx, authenticated, trustedBlock))

	consensusHeight := NewHeight(0, authenticated.anchorBlock.height)
	setAuthenticatedConsensusState(
		clientStore,
		cdc,
		consensusHeight,
		authenticated,
		bytes.Repeat([]byte{0x42}, 32),
		DefaultThresholdUniquePools,
		10_000,
		10_000,
	)

	storedTimestamp, err := clientState.GetTimestampAtHeight(ctx, clientStore, cdc, consensusHeight)
	require.NoError(t, err)
	require.Equal(t, authenticated.anchorBlock.timestamp, storedTimestamp)
	require.NotEqual(t, authenticated.descendantBlocks[len(authenticated.descendantBlocks)-1].timestamp, storedTimestamp)
	require.Greater(t, storedTimestamp, trustedBlock.timestamp)

	maximumAllowed, err := clientState.maximumAllowedCardanoTimestamp(ctx)
	require.NoError(t, err)
	timeoutBeyondAllowedDrift := maximumAllowed + 1
	require.Less(t, storedTimestamp, timeoutBeyondAllowedDrift)
}

func TestMisbehaviourVerifierUsesHistoricalTrustedTime(t *testing.T) {
	epochContext := newTemporalVerifierEpochContext(7, 0, 1_000_000, 0x07)
	ctx, cdc, clientStore, clientState := initializeTemporalVerifierClient(
		t,
		"probabilistic-temporal-historical-misbehaviour",
		100,
		epochContext,
	)

	latestHeight := NewHeight(0, 40)
	latestConsensus := newProbabilisticTestConsensusState("latest-40")
	latestConsensus.Timestamp = mustTestTimestampForSlot(t, clientState, 400)
	setConsensusState(clientStore, cdc, latestConsensus, latestHeight)
	clientState.LatestHeight = latestHeight
	setTestCheckpoint(t, clientState, latestHeight, latestConsensus.AcceptedBlockHash, 7, 400)
	setClientState(clientStore, cdc, clientState)
	ctx = temporalTestContext(t, clientState, 500)

	headerA := newTemporalVerifierHeader(t, clientState, "historical-a", 11, 110, 7, true)
	headerB := newTemporalVerifierHeader(t, clientState, "historical-b", 11, 111, 7, true)
	authenticatedByHash := map[string]*authenticatedProbabilisticHeader{
		headerA.AnchorBlock.Hash: newTemporalVerifierAuthenticatedHeader(t, clientState, "trusted-10", headerA.AnchorBlock.Hash, 11, 110, 7),
		headerB.AnchorBlock.Hash: newTemporalVerifierAuthenticatedHeader(t, clientState, "trusted-10", headerB.AnchorBlock.Hash, 11, 111, 7),
	}
	authenticate := temporalVerifierAuthenticator(t, authenticatedByHash)

	misbehaviour := &Misbehaviour{
		ProbabilisticHeader1: headerA,
		ProbabilisticHeader2: headerB,
	}
	require.NoError(t, clientState.verifyMisbehaviourWithAuthenticator(ctx, clientStore, cdc, misbehaviour, authenticate))

	regressiveHeader := newTemporalVerifierHeader(t, clientState, "historical-regressive", 11, 100, 7, true)
	authenticatedByHash[regressiveHeader.AnchorBlock.Hash] = newTemporalVerifierAuthenticatedHeader(
		t,
		clientState,
		"trusted-10",
		regressiveHeader.AnchorBlock.Hash,
		11,
		100,
		7,
	)
	misbehaviour.ProbabilisticHeader1 = regressiveHeader
	err := clientState.verifyMisbehaviourWithAuthenticator(ctx, clientStore, cdc, misbehaviour, authenticate)
	require.ErrorIs(t, err, ErrInvalidTimestamp)
	require.ErrorContains(t, err, "ProbabilisticHeader1")
	require.ErrorContains(t, err, "must be greater than previous authenticated slot")
}

func TestLegacyClientStateWireDecodesNewTemporalFieldsAsZero(t *testing.T) {
	legacyWire, err := hex.DecodeString(
		"0a0c63617264616e6f2d746573741202100a20079a0102100aa20107686173682d3130a80107b0013ec20102100a",
	)
	require.NoError(t, err)

	var decoded ClientState
	require.NoError(t, decoded.Unmarshal(legacyWire))
	require.Equal(t, "cardano-test", decoded.ChainId)
	require.EqualValues(t, 10, decoded.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, "hash-10", decoded.LatestCheckpointBlockHash)
	require.EqualValues(t, 7, decoded.LatestCheckpointEpoch)
	require.Zero(t, decoded.MaxClockDrift)
	require.Zero(t, decoded.LatestCheckpointSlot)
	require.Zero(t, decoded.LatestCheckpointTimestamp)
}

func TestClientStateRejectsMissingMaxClockDrift(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	require.NoError(t, clientState.Validate())

	clientState.MaxClockDrift = 0
	err := clientState.Validate()
	require.ErrorIs(t, err, ErrInvalidMaxClockDrift)

	clientState.MaxClockDrift = -time.Nanosecond
	err = clientState.Validate()
	require.ErrorIs(t, err, ErrInvalidMaxClockDrift)
}

func TestInitializePersistsTemporalCursorAcrossReload(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-temporal-initialize")
	clientState := newProbabilisticTestClientState()
	consensusState := newProbabilisticTestConsensusState("initial-block")
	consensusState.Timestamp = mustTestTimestampForSlot(t, clientState, 42)

	require.NoError(t, clientState.Initialize(ctx, cdc, clientStore, consensusState))
	reloaded, found := getClientState(clientStore, cdc)
	require.True(t, found)
	require.Equal(t, uint64(42), reloaded.LatestCheckpointSlot)
	require.Equal(t, consensusState.Timestamp, reloaded.LatestCheckpointTimestamp)

	trustedBlock, err := reloaded.latestTrustedBlockState(clientStore, cdc)
	require.NoError(t, err)
	require.Equal(t, uint64(42), trustedBlock.slot)
	require.Equal(t, consensusState.Timestamp, trustedBlock.timestamp)
}

func TestLegacyTemporalCursorHandlingFailsClosedOnlyForRootlessCheckpoint(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-legacy-temporal-cursor")
	clientState := newProbabilisticTestClientState()
	clientState.LatestCheckpointHeight = NewHeight(0, 20)
	clientState.LatestCheckpointBlockHash = "legacy-rootless-checkpoint"
	clientState.LatestCheckpointEpoch = 7

	err := clientState.validateCheckpointFields()
	require.ErrorIs(t, err, ErrInvalidTimestamp)
	require.ErrorContains(t, err, "app-state migration")

	clientState.LatestCheckpointHeight = NewHeight(0, 10)
	clientState.LatestCheckpointBlockHash = "legacy-root-bearing-checkpoint"
	require.NoError(t, clientState.validateCheckpointFields())
	consensusState := newProbabilisticTestConsensusState(clientState.LatestCheckpointBlockHash)
	consensusState.Timestamp = mustTestTimestampForSlot(t, clientState, 77)
	setConsensusState(clientStore, cdc, consensusState, clientState.LatestHeight)

	trustedBlock, err := clientState.latestTrustedBlockState(clientStore, cdc)
	require.NoError(t, err)
	require.Equal(t, uint64(77), trustedBlock.slot)
	require.Equal(t, consensusState.Timestamp, trustedBlock.timestamp)
}

func newTemporalTestHeader(
	t testing.TB,
	clientState *ClientState,
) (*authenticatedProbabilisticHeader, *trustedBlockState) {
	t.Helper()
	trustedBlock := &trustedBlockState{
		height:    NewHeight(0, 10),
		blockHash: "trusted",
		epoch:     7,
		slot:      100,
		timestamp: mustTestTimestampForSlot(t, clientState, 100),
	}
	header := &authenticatedProbabilisticHeader{
		bridgeBlocks: []*authenticatedProbabilisticBlock{
			newAuthenticatedTemporalTestBlock(t, clientState, 11, 110),
			newAuthenticatedTemporalTestBlock(t, clientState, 12, 120),
		},
		anchorBlock: newAuthenticatedTemporalTestBlock(t, clientState, 13, 130),
		descendantBlocks: []*authenticatedProbabilisticBlock{
			newAuthenticatedTemporalTestBlock(t, clientState, 14, 140),
			newAuthenticatedTemporalTestBlock(t, clientState, 15, 150),
		},
	}
	return header, trustedBlock
}

func newAuthenticatedTemporalTestBlock(
	t testing.TB,
	clientState *ClientState,
	height uint64,
	slot uint64,
) *authenticatedProbabilisticBlock {
	t.Helper()
	return &authenticatedProbabilisticBlock{
		height:    height,
		slot:      slot,
		timestamp: mustTestTimestampForSlot(t, clientState, slot),
		epoch:     7,
	}
}

func setAuthenticatedTestSlot(
	t testing.TB,
	clientState *ClientState,
	block *authenticatedProbabilisticBlock,
	slot uint64,
) {
	t.Helper()
	block.slot = slot
	block.timestamp = mustTestTimestampForSlot(t, clientState, slot)
}

func mustTestTimestampForSlot(t testing.TB, clientState *ClientState, slot uint64) uint64 {
	t.Helper()
	timestamp, err := clientState.DeriveTimestampFromSlot(slot)
	require.NoError(t, err)
	return timestamp
}

func temporalTestContext(t testing.TB, clientState *ClientState, hostSlot uint64) sdk.Context {
	t.Helper()
	hostTimestamp := mustTestTimestampForSlot(t, clientState, hostSlot)
	return sdk.Context{}.WithBlockTime(time.Unix(0, int64(hostTimestamp)))
}

func initializeTemporalVerifierClient(
	t *testing.T,
	storeName string,
	trustedSlot uint64,
	epochContext *EpochContext,
) (sdk.Context, codec.BinaryCodec, storetypes.KVStore, *ClientState) {
	t.Helper()
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, storeName)
	clientState := newProbabilisticTestClientState()
	setTemporalVerifierEpochContext(clientState, epochContext)
	consensusState := newProbabilisticTestConsensusState("trusted-10")
	consensusState.AcceptedEpoch = epochContext.Epoch
	consensusState.Timestamp = mustTestTimestampForSlot(t, clientState, trustedSlot)
	require.NoError(t, clientState.Initialize(ctx, cdc, clientStore, consensusState))

	reloaded, found := getClientState(clientStore, cdc)
	require.True(t, found)
	return ctx, cdc, clientStore, reloaded
}

func setTemporalVerifierEpochContext(clientState *ClientState, epochContext *EpochContext) {
	clientState.CurrentEpoch = epochContext.Epoch
	clientState.EpochContexts = []*EpochContext{cloneEpochContext(epochContext)}
	clientState.EpochStakeDistribution = cloneStakeDistributionEntries(epochContext.StakeDistribution)
	clientState.EpochNonce = bytes.Clone(epochContext.EpochNonce)
	clientState.CurrentEpochStartSlot = epochContext.EpochStartSlot
	clientState.CurrentEpochEndSlotExclusive = epochContext.EpochEndSlotExclusive
}

func newTemporalVerifierEpochContext(epoch, startSlot, endSlot uint64, seed byte) *EpochContext {
	stakeDistribution := make([]*StakeDistributionEntry, 0, DefaultThresholdUniquePools)
	for index := uint64(0); index < DefaultThresholdUniquePools; index++ {
		stakeDistribution = append(stakeDistribution, &StakeDistributionEntry{
			PoolId:                fmt.Sprintf("pool-%c", 'a'+rune(index)),
			Stake:                 1_000,
			VrfKeyHash:            bytes.Repeat([]byte{seed + byte(index) + 1}, 32),
			FirstRegistrationSlot: 1,
		})
	}
	return &EpochContext{
		Epoch:                 epoch,
		StakeDistribution:     stakeDistribution,
		EpochNonce:            bytes.Repeat([]byte{seed}, 32),
		SlotsPerKesPeriod:     129600,
		EpochStartSlot:        startSlot,
		EpochEndSlotExclusive: endSlot,
	}
}

func newTemporalVerifierHeader(
	t testing.TB,
	clientState *ClientState,
	anchorHash string,
	anchorHeight uint64,
	anchorSlot uint64,
	epoch uint64,
	isCheckpoint bool,
) *ProbabilisticHeader {
	t.Helper()
	anchor := &ProbabilisticBlock{
		Height:    NewHeight(0, anchorHeight),
		Hash:      anchorHash,
		Slot:      anchorSlot,
		Epoch:     epoch,
		Timestamp: mustTestTimestampForSlot(t, clientState, anchorSlot),
	}
	if isCheckpoint {
		anchor.HeaderCbor = []byte{0x01}
	} else {
		anchor.BlockCbor = []byte{0x01}
	}

	descendants := make([]*ProbabilisticBlock, 0, DefaultThresholdDepth)
	for index := uint64(0); index < DefaultThresholdDepth; index++ {
		slot := anchorSlot + index + 1
		descendants = append(descendants, &ProbabilisticBlock{
			Height:     NewHeight(0, anchorHeight+index+1),
			Hash:       fmt.Sprintf("%s-descendant-%d", anchorHash, index+1),
			Slot:       slot,
			Epoch:      epoch,
			Timestamp:  mustTestTimestampForSlot(t, clientState, slot),
			HeaderCbor: []byte{0x01},
		})
	}

	header := &ProbabilisticHeader{
		TrustedHeight:    NewHeight(0, 10),
		AnchorBlock:      anchor,
		DescendantBlocks: descendants,
		IsCheckpoint:     isCheckpoint,
	}
	if !isCheckpoint {
		header.HostStateTxHash = "deadbeef"
	}
	return header
}

func newTemporalVerifierAuthenticatedHeader(
	t testing.TB,
	clientState *ClientState,
	trustedHash string,
	anchorHash string,
	anchorHeight uint64,
	anchorSlot uint64,
	epoch uint64,
) *authenticatedProbabilisticHeader {
	t.Helper()
	anchor := &authenticatedProbabilisticBlock{
		height:    anchorHeight,
		slot:      anchorSlot,
		hash:      anchorHash,
		prevHash:  trustedHash,
		epoch:     epoch,
		timestamp: mustTestTimestampForSlot(t, clientState, anchorSlot),
	}
	descendants := make([]*authenticatedProbabilisticBlock, 0, DefaultThresholdDepth)
	previousHash := anchorHash
	for index := uint64(0); index < DefaultThresholdDepth; index++ {
		slot := anchorSlot + index + 1
		hash := fmt.Sprintf("%s-descendant-%d", anchorHash, index+1)
		descendants = append(descendants, &authenticatedProbabilisticBlock{
			height:     anchorHeight + index + 1,
			slot:       slot,
			hash:       hash,
			prevHash:   previousHash,
			epoch:      epoch,
			timestamp:  mustTestTimestampForSlot(t, clientState, slot),
			slotLeader: fmt.Sprintf("pool-%c", 'a'+rune(index%DefaultThresholdUniquePools)),
		})
		previousHash = hash
	}
	return &authenticatedProbabilisticHeader{
		anchorBlock:      anchor,
		descendantBlocks: descendants,
	}
}

func temporalVerifierAuthenticator(
	t testing.TB,
	authenticatedByHash map[string]*authenticatedProbabilisticHeader,
) headerAuthenticator {
	t.Helper()
	return func(
		header *ProbabilisticHeader,
		_ []*EpochContext,
		_ map[string]uint64,
	) (*authenticatedProbabilisticHeader, error) {
		authenticated, found := authenticatedByHash[header.AnchorBlock.Hash]
		require.True(t, found, "missing authenticated fixture for %s", header.AnchorBlock.Hash)
		return authenticated, nil
	}
}
