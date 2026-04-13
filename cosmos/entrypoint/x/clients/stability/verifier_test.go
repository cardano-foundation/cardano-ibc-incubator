package stability

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
	authenticatedHeader := &authenticatedStabilityHeader{
		bridgeBlocks: []*authenticatedStabilityBlock{
			{
				height:   11,
				hash:     "bridge-11",
				prevHash: "wrong-prev",
			},
		},
		anchorBlock: &authenticatedStabilityBlock{
			height:   12,
			hash:     "anchor-12",
			prevHash: "bridge-11",
		},
	}

	err := verifyBridgeContinuity(&Height{RevisionHeight: 10}, authenticatedHeader, trustedConsensus)
	require.ErrorContains(t, err, "does not connect to trusted chain")
}

func TestAuthenticateStabilityBlockRejectsMismatchedClaims(t *testing.T) {
	valid := makeTestStabilityBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))

	testCases := []struct {
		name   string
		mutate func(*StabilityBlock)
		want   string
	}{
		{
			name: "hash mismatch",
			mutate: func(block *StabilityBlock) {
				block.Hash = "deadbeef"
			},
			want: "block hash mismatch",
		},
		{
			name: "height mismatch",
			mutate: func(block *StabilityBlock) {
				block.Height = &Height{RevisionHeight: valid.Height.RevisionHeight + 1}
			},
			want: "block height mismatch",
		},
		{
			name: "slot mismatch",
			mutate: func(block *StabilityBlock) {
				block.Slot = valid.Slot + 1
			},
			want: "block slot mismatch",
		},
		{
			name: "timestamp mismatch",
			mutate: func(block *StabilityBlock) {
				block.Timestamp++
			},
			want: "block timestamp mismatch",
		},
	}

	cs := newStabilityTestClientState()
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			block := cloneTestStabilityBlock(valid)
			tc.mutate(block)
			_, err := cs.authenticateStabilityBlock(block, "anchor", mustTestEpochContexts(t, cs))
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestAuthenticateStabilityBlockDoesNotMutateInput(t *testing.T) {
	cs := newStabilityTestClientState()
	block := makeTestStabilityBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))
	block.Hash = "deadbeef"
	clone := cloneTestStabilityBlock(block)

	_, err := cs.authenticateStabilityBlock(block, "anchor", mustTestEpochContexts(t, cs))
	require.Error(t, err)
	require.Equal(t, clone, block)
}

func TestVerifyHostStateTxIncludedInAnchorBlockRejectsMissingTx(t *testing.T) {
	header := &StabilityHeader{
		AnchorBlock:     makeTestStabilityBlock(t, 30, 300, hex.EncodeToString(bytes.Repeat([]byte{0x33}, 32))),
		HostStateTxHash: "deadbeef",
	}

	err := verifyHostStateTxIncludedInAnchorBlock(header)
	require.ErrorContains(t, err, "not found in authenticated anchor block")
}

func TestVerifyHeaderRejectsMissingTrustedConsensus(t *testing.T) {
	cdc := newStabilityTestCodec()
	_, clientStore := newStabilityTestClientStore(t, "stability-missing-trusted")
	cs := newStabilityTestClientState()
	header := newVerifiedTestHeader(t)

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted consensus state not found")
}

func TestVerifyHeaderRejectsCrossEpochBlock(t *testing.T) {
	cdc := newStabilityTestCodec()
	_, clientStore := newStabilityTestClientStore(t, "stability-cross-epoch")
	cs := newStabilityTestClientState()

	header := newVerifiedTestHeader(t)
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	header.AnchorBlock = makeTestStabilityBlock(t, 12, cs.CurrentEpochEndSlotExclusive, header.BridgeBlocks[0].Hash)

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "outside available epoch context bounds")
}

func TestVerifyHeaderRejectsTrustedHeightOlderThanLatestHeight(t *testing.T) {
	cdc := newStabilityTestCodec()
	_, clientStore := newStabilityTestClientStore(t, "stability-stale-trusted")
	cs := newStabilityTestClientState()
	cs.LatestHeight = NewHeight(0, 11)

	header := newVerifiedTestHeader(t)
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(header.BridgeBlocks[0].Hash), NewHeight(0, 11))

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted height")
	require.ErrorContains(t, err, "must equal latest height")
}

func TestComputeHeaderSecurityMetricsRejectsEmptyEpochStakeDistribution(t *testing.T) {
	cs := newStabilityTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
	}

	authenticatedHeader := &authenticatedStabilityHeader{
		anchorBlock: &authenticatedStabilityBlock{
			height: 12,
			hash:   "anchor-12",
		},
	}

	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)
	require.ErrorContains(t, err, "stake distribution must not be empty")
}

func TestVerifyHeaderEpochTransitionAcceptsAdjacentEpochRollover(t *testing.T) {
	header := &StabilityHeader{
		NewEpochContext: &EpochContext{Epoch: 8},
	}
	trustedConsensus := &ConsensusState{AcceptedEpoch: 7}
	authenticatedHeader := &authenticatedStabilityHeader{
		anchorBlock: &authenticatedStabilityBlock{
			epoch: 8,
		},
		bridgeBlocks: []*authenticatedStabilityBlock{
			{epoch: 7},
			{epoch: 8},
		},
		descendantBlocks: []*authenticatedStabilityBlock{
			{epoch: 8},
		},
	}

	err := verifyHeaderEpochTransition(header, trustedConsensus, authenticatedHeader)
	require.NoError(t, err)
}

func TestCheckForMisbehaviourDetectsConflictingHeaderAtSameHeight(t *testing.T) {
	cdc := newStabilityTestCodec()
	ctx, clientStore := newStabilityTestClientStore(t, "stability-misbehaviour-header")

	cs := newStabilityTestClientState()
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState("trusted-hash"), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState("existing-anchor"), NewHeight(0, 12))

	header := newVerifiedTestHeader(t)
	header.AnchorBlock.Hash = "different-anchor"

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingWindowAgainstStoredConsensus(t *testing.T) {
	cdc := newStabilityTestCodec()
	ctx, clientStore := newStabilityTestClientStore(t, "stability-misbehaviour-window")

	cs := newStabilityTestClientState()
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState("trusted-hash"), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState("accepted-bridge-11"), NewHeight(0, 11))

	header := newVerifiedTestHeader(t)
	header.BridgeBlocks[0].Hash = "conflicting-bridge-11"

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingMisbehaviourMessage(t *testing.T) {
	cs := newStabilityTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header2.AnchorBlock.Hash = "different-anchor"

	msg := NewMisbehaviour("08-cardano-stability-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestVerifyMisbehaviourDoesNotRequireStoredTargetHeights(t *testing.T) {
	cdc := newStabilityTestCodec()
	ctx, clientStore := newStabilityTestClientStore(t, "stability-misbehaviour-unstored-heights")

	cs := newStabilityTestClientState()
	header := newVerifiedTestHeader(t)
	header.AnchorBlock = makeTestStabilityBlock(t, 12, cs.CurrentEpochEndSlotExclusive, header.BridgeBlocks[0].Hash)
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))

	msg := NewMisbehaviour("08-cardano-stability-0", header, header)
	err := cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "could not get consensus state from clientStore")
	require.Contains(t, err.Error(), "outside available epoch context bounds")
}

func TestVerifyMisbehaviourDoesNotRejectStoredHeadersAsStale(t *testing.T) {
	cdc := newStabilityTestCodec()
	ctx, clientStore := newStabilityTestClientStore(t, "stability-misbehaviour-stale")

	cs := newStabilityTestClientState()
	header := newVerifiedTestHeader(t)
	header.AnchorBlock = makeTestStabilityBlock(t, 12, cs.CurrentEpochEndSlotExclusive, header.BridgeBlocks[0].Hash)
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(header.AnchorBlock.Hash), header.GetHeight())

	msg := NewMisbehaviour("08-cardano-stability-0", header, header)
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
	header2.AnchorBlock = makeTestStabilityBlock(t, 14, 140, header1.DescendantBlocks[0].Hash)
	header2.BridgeBlocks = []*StabilityBlock{
		cloneTestStabilityBlock(header1.BridgeBlocks[0]),
		cloneTestStabilityBlock(header1.AnchorBlock),
		cloneTestStabilityBlock(header1.DescendantBlocks[0]),
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
	cdc := newStabilityTestCodec()
	ctx, clientStore := newStabilityTestClientStore(t, "stability-prune-oldest")

	cs := newStabilityTestClientState()
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

func TestSetConsensusMetadataStoresParseableProcessedHeight(t *testing.T) {
	ctx, clientStore := newStabilityTestClientStore(t, "stability-processed-height")
	consensusHeight := NewHeight(0, 42)

	setConsensusMetadata(ctx, clientStore, consensusHeight)

	processedHeight, found := GetProcessedHeight(clientStore, consensusHeight)
	require.True(t, found)
	require.Equal(t, clienttypes.GetSelfHeight(ctx), processedHeight)
}

func newStabilityTestCodec() codec.BinaryCodec {
	registry := codectypes.NewInterfaceRegistry()
	RegisterInterfaces(registry)
	return codec.NewProtoCodec(registry)
}

func newStabilityTestClientStore(t *testing.T, keyName string) (sdk.Context, storetypes.KVStore) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "entrypoint-test",
		Height:  100,
		Time:    time.Unix(1_700_000_000, 0),
	}, false, log.NewNopLogger())

	return ctx, stateStore.GetKVStore(key)
}

func newStabilityTestClientState() *ClientState {
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
				PoolId:     "pool-a",
				Stake:      10_000,
				VrfKeyHash: bytes.Repeat([]byte{0x02}, 32),
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

func newStabilityTestConsensusState(acceptedBlockHash string) *ConsensusState {
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

func newVerifiedTestHeader(t *testing.T) *StabilityHeader {
	t.Helper()

	trustedHash := bytes.Repeat([]byte{0x11}, 32)
	bridge := makeTestStabilityBlock(t, 11, 110, hex.EncodeToString(trustedHash))
	anchor := makeTestStabilityBlock(t, 12, 120, bridge.Hash)
	descendant := makeTestStabilityBlock(t, 13, 130, anchor.Hash)

	return &StabilityHeader{
		TrustedHeight:          &Height{RevisionHeight: 10},
		BridgeBlocks:           []*StabilityBlock{bridge},
		AnchorBlock:            anchor,
		DescendantBlocks:       []*StabilityBlock{descendant},
		HostStateTxHash:        "deadbeef",
		HostStateTxOutputIndex: 0,
	}
}

func makeTestStabilityBlock(t *testing.T, blockNumber, slot uint64, prevHashHex string) *StabilityBlock {
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

	return &StabilityBlock{
		Height:    &Height{RevisionHeight: block.BlockNumber()},
		Hash:      block.Hash(),
		Slot:      block.SlotNumber(),
		Epoch:     7,
		Timestamp: 1_700_000_000_000_000_000 + block.SlotNumber()*1_000_000_000,
		BlockCbor: blockCbor,
	}
}

func mustTestBlockPrevHash(t *testing.T, block *StabilityBlock) string {
	t.Helper()

	decodedBlock, err := decodeLedgerBlock(block.BlockCbor)
	require.NoError(t, err)

	prevHash, err := blockPrevHash(decodedBlock)
	require.NoError(t, err)

	return prevHash
}

func cloneTestStabilityBlock(block *StabilityBlock) *StabilityBlock {
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
