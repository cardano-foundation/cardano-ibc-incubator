package state

import (
	"bytes"
	"fmt"
	"testing"
	"time"

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

func TestClientStateRejectsMissingMaxClockDrift(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	require.NoError(t, validateBootstrapInput(*clientState))

	clientState.MaxClockDrift = 0
	err := validateBootstrapInput(*clientState)
	require.ErrorIs(t, err, ErrInvalidMaxClockDrift)

	clientState.MaxClockDrift = -time.Nanosecond
	err = validateBootstrapInput(*clientState)
	require.ErrorIs(t, err, ErrInvalidMaxClockDrift)
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

func temporalTestContext(t testing.TB, clientState *ClientState, hostSlot uint64) Context {
	t.Helper()
	hostTimestamp := mustTestTimestampForSlot(t, clientState, hostSlot)
	return Context{Height: 100, HostProgress: testHostProgress}.WithBlockTime(time.Unix(0, int64(hostTimestamp)))
}

func setTemporalVerifierEpochContext(clientState *ClientState, epochContext *EpochContext) {
	clientState.CurrentEpoch = epochContext.Epoch
	clientState.EpochContexts = []*EpochContext{cloneEpochContext(epochContext)}
	clientState.EpochStakeDistribution = cloneStakeDistributionEntries(epochContext.StakeDistribution)
	clientState.EpochNonce = bytes.Clone(epochContext.EpochNonce)
	clientState.LatestCheckpointNonceState = testNonceState(epochContext.EpochNonce)
	clientState.LatestCheckpointPoolRegistry = testPoolRegistry(epochContext.Epoch, epochContext.StakeDistribution)
	clientState.LatestCheckpointSettlementCredit = mustTestSettlementCredit(epochContext)
	clientState.LatestCheckpointPoolProduction = testPoolProduction(epochContext)
	clientState.CurrentEpochStartSlot = epochContext.EpochStartSlot
	clientState.CurrentEpochEndSlotExclusive = epochContext.EpochEndSlotExclusive
}

func newTemporalVerifierEpochContext(epoch, startSlot, endSlot uint64, seed byte) *EpochContext {
	stakeDistribution := make([]*StakeDistributionEntry, 0, DefaultThresholdUniquePools)
	for index := uint64(0); index < DefaultThresholdUniquePools; index++ {
		stakeDistribution = append(stakeDistribution, &StakeDistributionEntry{
			PoolId:                   fmt.Sprintf("pool-%c", 'a'+rune(index)),
			Stake:                    1_000,
			VrfKeyHash:               bytes.Repeat([]byte{8 + byte(index)}, 32),
			FirstRegistrationSlot:    1,
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: DefaultThresholdUniquePools,
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
	full := makeTestProbabilisticBlock(t, anchorHeight, anchorSlot, testBlockHash("trusted-10"))
	anchor.BlockCbor = full.BlockCbor
	anchor.Hash = full.Hash

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
		slotLeader: "pool-a",
		height:     anchorHeight,
		slot:       anchorSlot,
		hash:       anchorHash,
		prevHash:   trustedHash,
		epoch:      epoch,
		timestamp:  mustTestTimestampForSlot(t, clientState, anchorSlot),
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
		contexts []*EpochContext,
		_ map[string]uint64, trusted *trustedBlockState) (*authenticatedProbabilisticHeader, error) {
		authenticated, found := authenticatedByHash[header.AnchorBlock.Hash]
		require.True(t, found, "missing authenticated fixture for %s", header.AnchorBlock.Hash)
		authenticated.anchorNonceState = testNonceState(epochContextByEpoch(contexts, authenticated.anchorBlock.epoch).EpochNonce)
		authenticated.anchorPoolRegistry = testPoolRegistryAtEpoch(t, trusted.poolRegistry, authenticated.anchorBlock.epoch)
		return authenticated, nil
	}
}
