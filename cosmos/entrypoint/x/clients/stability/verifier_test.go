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
	"github.com/stretchr/testify/require"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
)

func TestVerifyBridgeContinuityRejectsBadPrevHash(t *testing.T) {
	header := &StabilityHeader{
		TrustedHeight: &Height{RevisionHeight: 10},
		BridgeBlocks: []*StabilityBlock{
			{
				Height:   &Height{RevisionHeight: 11},
				Hash:     "bridge-11",
				PrevHash: "wrong-prev",
			},
		},
		AnchorBlock: &StabilityBlock{
			Height:   &Height{RevisionHeight: 12},
			Hash:     "anchor-12",
			PrevHash: "bridge-11",
		},
	}
	trustedConsensus := &ConsensusState{
		Timestamp:         uint64(time.Now().UnixNano()),
		IbcStateRoot:      bytes.Repeat([]byte{0x01}, 32),
		AcceptedBlockHash: "trusted-hash",
	}

	err := verifyBridgeContinuity(header, trustedConsensus)
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
			name: "prev hash mismatch",
			mutate: func(block *StabilityBlock) {
				block.PrevHash = "deadbeef"
			},
			want: "block prev_hash mismatch",
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
	}

	cs := newStabilityTestClientState()
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			block := cloneTestStabilityBlock(valid)
			tc.mutate(block)
			err := cs.authenticateStabilityBlock(block, "anchor")
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestVerifyHostStateTxIncludedInAnchorBlockRejectsMissingTx(t *testing.T) {
	header := &StabilityHeader{
		AnchorBlock:         makeTestStabilityBlock(t, 30, 300, hex.EncodeToString(bytes.Repeat([]byte{0x33}, 32))),
		HostStateTxHash:     "deadbeef",
		HostStateTxBodyCbor: []byte{0x01},
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
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(header.BridgeBlocks[0].PrevHash), NewHeight(0, 10))
	header.AnchorBlock.Epoch = cs.CurrentEpoch + 1

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "epoch mismatch")
}

func TestVerifyHeaderRejectsTrustedHeightOlderThanLatestHeight(t *testing.T) {
	cdc := newStabilityTestCodec()
	_, clientStore := newStabilityTestClientStore(t, "stability-stale-trusted")
	cs := newStabilityTestClientState()
	cs.LatestHeight = NewHeight(0, 11)

	header := newVerifiedTestHeader(t)
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(header.BridgeBlocks[0].PrevHash), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newStabilityTestConsensusState(header.BridgeBlocks[0].Hash), NewHeight(0, 11))

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted height")
	require.ErrorContains(t, err, "must equal latest height")
}

func TestComputeHeaderSecurityMetricsRejectsEmptyEpochStakeDistribution(t *testing.T) {
	cs := newStabilityTestClientState()
	cs.EpochStakeDistribution = nil

	_, _, _, err := cs.computeHeaderSecurityMetrics(newVerifiedTestHeader(t))
	require.ErrorContains(t, err, "epoch stake distribution must not be empty")
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

func TestCheckForMisbehaviourDetectsConflictingMisbehaviourMessage(t *testing.T) {
	cs := newStabilityTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header2.AnchorBlock.Hash = "different-anchor"

	msg := NewMisbehaviour("08-cardano-stability-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestHeadersConflictRejectsNonConflictingHeaders(t *testing.T) {
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)

	require.False(t, headersConflict(header1, header2))

	header2.AnchorBlock.Hash = "different-anchor"
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
	descendant.SlotLeader = "pool-a"

	return &StabilityHeader{
		TrustedHeight:          &Height{RevisionHeight: 10},
		BridgeBlocks:           []*StabilityBlock{bridge},
		AnchorBlock:            anchor,
		DescendantBlocks:       []*StabilityBlock{descendant},
		HostStateTxHash:        "deadbeef",
		HostStateTxBodyCbor:    []byte{0x01},
		HostStateTxOutputIndex: 0,
		UniquePoolsCount:       1,
		UniqueStakeBps:         10_000,
		SecurityScoreBps:       10_000,
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
		Height:     &Height{RevisionHeight: block.BlockNumber()},
		Hash:       block.Hash(),
		PrevHash:   block.Header.Body.PrevHash.String(),
		Slot:       block.SlotNumber(),
		Epoch:      7,
		Timestamp:  1_700_000_000_000_000_000,
		SlotLeader: block.IssuerVkey().PoolId(),
		BlockCbor:  blockCbor,
	}
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
