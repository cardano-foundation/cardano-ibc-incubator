package probabilistic

import (
	"bytes"
	"encoding/hex"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func TestVerifyBridgeContinuityRejectsBadPrevHash(t *testing.T) {
	trustedConsensus := &ConsensusState{
		Timestamp:         uint64(time.Now().UnixNano()),
		IbcStateRoot:      bytes.Repeat([]byte{0x01}, 32),
		AcceptedBlockHash: "trusted-hash",
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		bridgeBlocks: []*authenticatedProbabilisticBlock{
			{
				height:   11,
				hash:     "bridge-11",
				prevHash: "wrong-prev",
			},
		},
		anchorBlock: &authenticatedProbabilisticBlock{
			height:   12,
			hash:     "anchor-12",
			prevHash: "bridge-11",
		},
	}

	err := verifyBridgeContinuity(&Height{RevisionHeight: 10}, authenticatedHeader, trustedConsensus)
	require.ErrorContains(t, err, "does not connect to trusted chain")
}

func TestAuthenticateProbabilisticBlockRejectsMismatchedClaims(t *testing.T) {
	valid := makeTestProbabilisticBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))

	testCases := []struct {
		name   string
		mutate func(*ProbabilisticBlock)
		want   string
	}{
		{
			name: "hash mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Hash = "deadbeef"
			},
			want: "block hash mismatch",
		},
		{
			name: "height mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Height = &Height{RevisionHeight: valid.Height.RevisionHeight + 1}
			},
			want: "block height mismatch",
		},
		{
			name: "slot mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Slot = valid.Slot + 1
			},
			want: "block slot mismatch",
		},
		{
			name: "timestamp mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Timestamp++
			},
			want: "block timestamp mismatch",
		},
	}

	cs := newProbabilisticTestClientState()
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			block := cloneTestProbabilisticBlock(valid)
			tc.mutate(block)
			_, err := cs.authenticateProbabilisticBlock(block, "anchor", mustTestEpochContexts(t, cs))
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestAuthenticateProbabilisticBlockDoesNotMutateInput(t *testing.T) {
	cs := newProbabilisticTestClientState()
	block := makeTestProbabilisticBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))
	block.Hash = "deadbeef"
	clone := cloneTestProbabilisticBlock(block)

	_, err := cs.authenticateProbabilisticBlock(block, "anchor", mustTestEpochContexts(t, cs))
	require.Error(t, err)
	require.Equal(t, clone, block)
}

func TestVerifyHostStateTxIncludedInAnchorBlockRejectsMissingTx(t *testing.T) {
	header := &ProbabilisticHeader{
		AnchorBlock:     makeTestProbabilisticBlock(t, 30, 300, hex.EncodeToString(bytes.Repeat([]byte{0x33}, 32))),
		HostStateTxHash: "deadbeef",
	}

	err := verifyHostStateTxIncludedInAnchorBlock(header)
	require.ErrorContains(t, err, "not found in authenticated anchor block")
}

func TestVerifyHeaderRejectsMissingTrustedConsensus(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-missing-trusted")
	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted consensus state not found")
}

func TestVerifyHeaderRejectsCrossEpochBlock(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-cross-epoch")
	cs := newProbabilisticTestClientState()

	header := newVerifiedTestHeader(t)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	header.AnchorBlock = makeTestProbabilisticBlock(t, 12, cs.CurrentEpochEndSlotExclusive, header.BridgeBlocks[0].Hash)

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "outside available epoch context bounds")
}

func TestVerifyHeaderRejectsTrustedHeightOlderThanLatestHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-stale-trusted")
	cs := newProbabilisticTestClientState()
	cs.LatestHeight = NewHeight(0, 11)

	header := newVerifiedTestHeader(t)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(header.BridgeBlocks[0].Hash), NewHeight(0, 11))

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted height")
	require.ErrorContains(t, err, "must equal latest height")
}

func TestComputeHeaderSecurityMetricsRejectsEmptyEpochStakeDistribution(t *testing.T) {
	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
	}

	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
		},
	}

	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)
	require.ErrorContains(t, err, "stake distribution must not be empty")
}

func TestComputeHeaderSecurityMetricsExcludesPoolsRegisteredAfterCutoff(t *testing.T) {
	cs := newProbabilisticTestClientState()
	cutoffSlot, err := cs.poolRegistrationCutoffSlotExclusive()
	require.NoError(t, err)
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                "pool-a",
				Stake:                 500,
				VrfKeyHash:            bytes.Repeat([]byte{0x02}, 32),
				FirstRegistrationSlot: 1,
			},
			{
				PoolId:                "pool-b",
				Stake:                 500,
				VrfKeyHash:            bytes.Repeat([]byte{0x04}, 32),
				FirstRegistrationSlot: cutoffSlot,
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			slot:   120,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
			{height: 14, hash: "descendant-14", prevHash: "descendant-13", epoch: cs.CurrentEpoch, slotLeader: "pool-b"},
		},
	}

	qualifiedUniquePools, qualifiedUniqueStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.NoError(t, err)
	require.Equal(t, uint64(1), qualifiedUniquePools)
	require.Equal(t, uint64(5000), qualifiedUniqueStakeBps)
}

func TestComputeHeaderSecurityMetricsFailsClosedWhenPoolAgeIsMissing(t *testing.T) {
	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:     "pool-a",
				Stake:      10_000,
				VrfKeyHash: bytes.Repeat([]byte{0x02}, 32),
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			slot:   120,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
		},
	}

	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.ErrorContains(t, err, "first registration slot missing")
}

func TestVerifyHeaderEpochTransitionAcceptsAdjacentEpochRollover(t *testing.T) {
	header := &ProbabilisticHeader{
		NewEpochContext: &EpochContext{Epoch: 8},
	}
	trustedConsensus := &ConsensusState{AcceptedEpoch: 7}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			epoch: 8,
		},
		bridgeBlocks: []*authenticatedProbabilisticBlock{
			{epoch: 7},
			{epoch: 8},
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{epoch: 8},
		},
	}

	err := verifyHeaderEpochTransition(header, trustedConsensus, authenticatedHeader)
	require.NoError(t, err)
}

func TestVerifyHeaderEpochTransitionAcceptsMatchingSameEpochContext(t *testing.T) {
	header := &ProbabilisticHeader{
		NewEpochContext: &EpochContext{Epoch: 7},
	}
	trustedConsensus := &ConsensusState{AcceptedEpoch: 7}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock:      &authenticatedProbabilisticBlock{epoch: 7},
		bridgeBlocks:     []*authenticatedProbabilisticBlock{{epoch: 7}},
		descendantBlocks: []*authenticatedProbabilisticBlock{{epoch: 7}},
	}

	err := verifyHeaderEpochTransition(header, trustedConsensus, authenticatedHeader)
	require.NoError(t, err)
}

func TestVerifyHeaderEpochTransitionRejectsMismatchedSameEpochContext(t *testing.T) {
	header := &ProbabilisticHeader{
		NewEpochContext: &EpochContext{Epoch: 8},
	}
	trustedConsensus := &ConsensusState{AcceptedEpoch: 7}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock:      &authenticatedProbabilisticBlock{epoch: 7},
		bridgeBlocks:     []*authenticatedProbabilisticBlock{{epoch: 7}},
		descendantBlocks: []*authenticatedProbabilisticBlock{{epoch: 7}},
	}

	err := verifyHeaderEpochTransition(header, trustedConsensus, authenticatedHeader)
	require.ErrorContains(t, err, "same-epoch new_epoch_context epoch 8 must match accepted epoch 7")
}

func TestNormalizeEpochContextsRejectsConflictingDuplicateEpoch(t *testing.T) {
	cs := newProbabilisticTestClientState()
	first := cloneEpochContext(cs.legacyEpochContext())
	second := cloneEpochContext(first)
	second.StakeDistribution[0].Stake++

	_, err := normalizeEpochContexts([]*EpochContext{first, second})
	require.ErrorContains(t, err, "conflicting epoch context for epoch 7")
}

func TestMergeEpochContextsAllowsCandidateForStoredEpoch(t *testing.T) {
	cs := newProbabilisticTestClientState()
	stored := cloneEpochContext(cs.legacyEpochContext())
	candidate := cloneEpochContext(stored)
	candidate.StakeDistribution[0].Stake++

	contexts, err := mergeEpochContexts([]*EpochContext{stored}, candidate)
	require.NoError(t, err)
	require.Len(t, contexts, 1)
	require.Equal(t, candidate.StakeDistribution[0].Stake, contexts[0].StakeDistribution[0].Stake)
}

func TestCheckForMisbehaviourDetectsConflictingHeaderAtSameHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-header")

	cs := newProbabilisticTestClientState()
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("trusted-hash"), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("existing-anchor"), NewHeight(0, 12))

	header := newVerifiedTestHeader(t)
	header.AnchorBlock.Hash = "different-anchor"

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingEpochContext(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-epoch-context")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(cs.legacyEpochContext())
	header.NewEpochContext.StakeDistribution[0].Stake++

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourIgnoresMatchingEpochContext(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-matching-epoch-context")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(cs.legacyEpochContext())

	require.False(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingWindowAgainstStoredConsensus(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-window")

	cs := newProbabilisticTestClientState()
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("trusted-hash"), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("accepted-bridge-11"), NewHeight(0, 11))

	header := newVerifiedTestHeader(t)
	header.BridgeBlocks[0].Hash = "conflicting-bridge-11"

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingMisbehaviourMessage(t *testing.T) {
	cs := newProbabilisticTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header2.AnchorBlock.Hash = "different-anchor"

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestCheckForMisbehaviourDetectsConflictingEpochContextsInMisbehaviourMessage(t *testing.T) {
	cs := newProbabilisticTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header1.NewEpochContext = cloneEpochContext(cs.legacyEpochContext())
	header2.NewEpochContext = cloneEpochContext(header1.NewEpochContext)
	header2.NewEpochContext.StakeDistribution[0].Stake++

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestVerifyMisbehaviourDoesNotRequireStoredTargetHeights(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-unstored-heights")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.AnchorBlock = makeTestProbabilisticBlock(t, 12, cs.CurrentEpochEndSlotExclusive, header.BridgeBlocks[0].Hash)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header, header)
	err := cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "could not get consensus state from clientStore")
	require.Contains(t, err.Error(), "outside available epoch context bounds")
}

func TestVerifyMisbehaviourDoesNotRejectStoredHeadersAsStale(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-stale")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.AnchorBlock = makeTestProbabilisticBlock(t, 12, cs.CurrentEpochEndSlotExclusive, header.BridgeBlocks[0].Hash)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(header.AnchorBlock.Hash), header.GetHeight())

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header, header)
	err := cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "expected newer header height")
	require.Contains(t, err.Error(), "outside available epoch context bounds")
}

func TestHeadersConflictRejectsNonConflictingHeaders(t *testing.T) {
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)

	require.False(t, headersConflict(header1, header2))

	header2.AnchorBlock.Hash = "different-anchor"
	require.True(t, headersConflict(header1, header2))
}

func TestHeadersConflictDetectsDifferentHeightOverlapMismatch(t *testing.T) {
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header2.AnchorBlock = makeTestProbabilisticBlock(t, 14, 140, header1.DescendantBlocks[0].Hash)
	header2.BridgeBlocks = []*ProbabilisticBlock{
		cloneTestProbabilisticBlock(header1.BridgeBlocks[0]),
		cloneTestProbabilisticBlock(header1.AnchorBlock),
		cloneTestProbabilisticBlock(header1.DescendantBlocks[0]),
	}
	header2.DescendantBlocks = nil

	require.False(t, headersConflict(header1, header2))

	header2.BridgeBlocks[0].Hash = "conflicting-bridge-11"
	require.True(t, headersConflict(header1, header2))
}

func TestHeaderValidateBasicRejectsTrustedHeightEdgeCases(t *testing.T) {
	header := newVerifiedTestHeader(t)

	header.TrustedHeight = &Height{}
	err := header.ValidateBasic()
	require.ErrorContains(t, err, "trusted height cannot be zero")

	header = newVerifiedTestHeader(t)
	header.TrustedHeight = &Height{RevisionHeight: header.AnchorBlock.Height.RevisionHeight}
	err = header.ValidateBasic()
	require.ErrorContains(t, err, "trusted height")
}

func TestPruneOldestConsensusStateRemovesLowestExpiredHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-prune-oldest")

	cs := newProbabilisticTestClientState()
	cs.TrustingPeriod = time.Second

	expiredAt := uint64(ctx.BlockTime().Add(-2 * time.Second).UnixNano())
	freshAt := uint64(ctx.BlockTime().UnixNano())

	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         expiredAt,
		IbcStateRoot:      bytes.Repeat([]byte{0x01}, 32),
		AcceptedBlockHash: "hash-10",
		AcceptedEpoch:     7,
	}, NewHeight(0, 10))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 10), NewHeight(0, 10), expiredAt)

	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         expiredAt,
		IbcStateRoot:      bytes.Repeat([]byte{0x02}, 32),
		AcceptedBlockHash: "hash-11",
		AcceptedEpoch:     7,
	}, NewHeight(0, 11))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 11), NewHeight(0, 11), expiredAt)

	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         freshAt,
		IbcStateRoot:      bytes.Repeat([]byte{0x03}, 32),
		AcceptedBlockHash: "hash-12",
		AcceptedEpoch:     7,
	}, NewHeight(0, 12))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 12), NewHeight(0, 12), freshAt)

	_, found10Before := GetConsensusState(clientStore, cdc, NewHeight(0, 10))
	_, found11Before := GetConsensusState(clientStore, cdc, NewHeight(0, 11))
	_, found12Before := GetConsensusState(clientStore, cdc, NewHeight(0, 12))
	require.True(t, found10Before)
	require.True(t, found11Before)
	require.True(t, found12Before)

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

	_, found10 := GetConsensusState(clientStore, cdc, NewHeight(0, 10))
	_, found11 := GetConsensusState(clientStore, cdc, NewHeight(0, 11))
	_, found12 := GetConsensusState(clientStore, cdc, NewHeight(0, 12))

	require.False(t, found10)
	require.True(t, found11)
	require.True(t, found12)
}

func TestCollectReferencedConsensusEpochsCollectsAllStoredEpochs(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-collect-epochs")

	consensus7 := newProbabilisticTestConsensusState("hash-10")
	consensus7.AcceptedEpoch = 7
	setConsensusState(clientStore, cdc, consensus7, NewHeight(0, 10))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 10), NewHeight(0, 10), consensus7.Timestamp)

	consensus8 := newProbabilisticTestConsensusState("hash-11")
	consensus8.AcceptedEpoch = 8
	setConsensusState(clientStore, cdc, consensus8, NewHeight(0, 11))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 11), NewHeight(0, 11), consensus8.Timestamp)

	consensus9 := newProbabilisticTestConsensusState("hash-12")
	consensus9.AcceptedEpoch = 9
	setConsensusState(clientStore, cdc, consensus9, NewHeight(0, 12))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 12), NewHeight(0, 12), consensus9.Timestamp)

	referencedEpochs := collectReferencedConsensusEpochs(clientStore, cdc)

	require.Equal(t, map[uint64]struct{}{
		7: {},
		8: {},
		9: {},
	}, referencedEpochs)
}

func TestSetConsensusMetadataStoresParseableProcessedHeight(t *testing.T) {
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-processed-height")
	consensusHeight := NewHeight(0, 42)

	setConsensusMetadata(ctx, clientStore, consensusHeight)

	processedHeight, found := GetProcessedHeight(clientStore, consensusHeight)
	require.True(t, found)
	require.Equal(t, clienttypes.GetSelfHeight(ctx), processedHeight)
}

func newProbabilisticTestCodec() codec.BinaryCodec {
	registry := codectypes.NewInterfaceRegistry()
	RegisterInterfaces(registry)
	return codec.NewProtoCodec(registry)
}

func newProbabilisticTestClientStore(t *testing.T, keyName string) (sdk.Context, storetypes.KVStore) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "cardano-entrypoint-test",
		Height:  100,
		Time:    time.Unix(1_700_000_000, 0),
	}, false, log.NewNopLogger())

	return ctx, stateStore.GetKVStore(key)
}

func newProbabilisticTestClientState() *ClientState {
	zeroHeight := ZeroHeight()
	return &ClientState{
		ChainId:        "cardano-test",
		LatestHeight:   &Height{RevisionHeight: 10},
		FrozenHeight:   zeroHeight,
		CurrentEpoch:   7,
		TrustingPeriod: 24 * time.Hour,
		HeuristicParams: &HeuristicParams{
			ThresholdDepth:          1,
			ThresholdUniquePools:    1,
			ThresholdUniqueStakeBps: 1,
			DepthWeightBps:          2000,
			PoolsWeightBps:          2000,
			StakeWeightBps:          6000,
		},
		HostStateNftPolicyId:  bytes.Repeat([]byte{0x01}, 28),
		HostStateNftTokenName: []byte("host-state"),
		EpochStakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                "pool-a",
				Stake:                 10_000,
				VrfKeyHash:            bytes.Repeat([]byte{0x02}, 32),
				FirstRegistrationSlot: 1,
			},
		},
		EpochNonce:                   bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:            129600,
		CurrentEpochStartSlot:        0,
		CurrentEpochEndSlotExclusive: 1_000_000,
		SystemStartUnixNs:            1_700_000_000_000_000_000,
		SlotLengthNs:                 1_000_000_000,
	}
}

func newProbabilisticTestConsensusState(acceptedBlockHash string) *ConsensusState {
	return &ConsensusState{
		Timestamp:         uint64(time.Unix(1_700_000_000, 0).UnixNano()),
		IbcStateRoot:      bytes.Repeat([]byte{0x11}, 32),
		AcceptedBlockHash: acceptedBlockHash,
		AcceptedEpoch:     7,
		UniquePoolsCount:  1,
		UniqueStakeBps:    10_000,
		SecurityScoreBps:  10_000,
	}
}

func newVerifiedTestHeader(t *testing.T) *ProbabilisticHeader {
	t.Helper()

	trustedHash := bytes.Repeat([]byte{0x11}, 32)
	bridge := makeTestProbabilisticBlock(t, 11, 110, hex.EncodeToString(trustedHash))
	anchor := makeTestProbabilisticBlock(t, 12, 120, bridge.Hash)
	descendant := makeTestProbabilisticBlock(t, 13, 130, anchor.Hash)

	return &ProbabilisticHeader{
		TrustedHeight:          &Height{RevisionHeight: 10},
		BridgeBlocks:           []*ProbabilisticBlock{bridge},
		AnchorBlock:            anchor,
		DescendantBlocks:       []*ProbabilisticBlock{descendant},
		HostStateTxHash:        "deadbeef",
		HostStateTxOutputIndex: 0,
	}
}

func makeTestProbabilisticBlock(t *testing.T, blockNumber, slot uint64, prevHashHex string) *ProbabilisticBlock {
	t.Helper()

	block := ledger.BabbageBlock{
		Header: &ledger.BabbageBlockHeader{},
	}
	block.Header.Body.BlockNumber = blockNumber
	block.Header.Body.Slot = slot
	if prevHashHex != "" {
		prevHashBytes, err := hex.DecodeString(prevHashHex)
		require.NoError(t, err)
		block.Header.Body.PrevHash = ledger.NewBlake2b256(prevHashBytes)
	}

	blockCbor, err := cbor.Encode(block)
	require.NoError(t, err)
	_, err = cbor.Decode(blockCbor, &block)
	require.NoError(t, err)

	return &ProbabilisticBlock{
		Height:    &Height{RevisionHeight: block.BlockNumber()},
		Hash:      block.Hash(),
		Slot:      block.SlotNumber(),
		Epoch:     7,
		Timestamp: 1_700_000_000_000_000_000 + block.SlotNumber()*1_000_000_000,
		BlockCbor: blockCbor,
	}
}

func mustTestBlockPrevHash(t *testing.T, block *ProbabilisticBlock) string {
	t.Helper()

	decodedBlock, err := decodeLedgerBlock(block.BlockCbor)
	require.NoError(t, err)

	prevHash, err := blockPrevHash(decodedBlock)
	require.NoError(t, err)

	return prevHash
}

func cloneTestProbabilisticBlock(block *ProbabilisticBlock) *ProbabilisticBlock {
	if block == nil {
		return nil
	}
	clone := *block
	if block.Height != nil {
		height := *block.Height
		clone.Height = &height
	}
	if block.BlockCbor != nil {
		clone.BlockCbor = append([]byte(nil), block.BlockCbor...)
	}
	return &clone
}

func mustTestEpochContexts(t *testing.T, cs *ClientState) []*EpochContext {
	t.Helper()

	contexts, err := cs.normalizedEpochContexts()
	require.NoError(t, err)
	return contexts
}
