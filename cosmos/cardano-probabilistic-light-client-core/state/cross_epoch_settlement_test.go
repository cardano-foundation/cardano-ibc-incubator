package state

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/stretchr/testify/require"
)

func boundaryHeaderAtAnchor(t *testing.T, original *ProbabilisticHeader, trusted, anchor uint64) *ProbabilisticHeader {
	t.Helper()
	result := cloneNativeHeader(t, original)
	blocks := append(result.BridgeBlocks, result.AnchorBlock)
	blocks = append(blocks, result.DescendantBlocks...)
	result.TrustedHeight = NewHeight(0, trusted)
	result.BridgeBlocks, result.DescendantBlocks = nil, nil
	for _, block := range blocks {
		height := block.Height.RevisionHeight
		if height <= trusted {
			continue
		}
		if height < anchor {
			result.BridgeBlocks = append(result.BridgeBlocks, block)
		} else if height == anchor {
			result.AnchorBlock = block
		} else {
			var fields []cbor.RawMessage
			_, err := cbor.Decode(block.BlockCbor, &fields)
			require.NoError(t, err)
			block.HeaderCbor, block.BlockCbor = bytes.Clone(fields[0]), nil
			result.DescendantBlocks = append(result.DescendantBlocks, block)
		}
	}
	return result
}

func loadCombinedBoundaryFixture(t *testing.T) nativeBoundaryFixture {
	t.Helper()
	f, err := os.Open("../testdata/native-boundary-combined.json.gz")
	require.NoError(t, err)
	defer f.Close()
	r, err := gzip.NewReader(f)
	require.NoError(t, err)
	defer r.Close()
	data, err := io.ReadAll(r)
	require.NoError(t, err)
	var fixture nativeBoundaryFixture
	require.NoError(t, json.Unmarshal(data, &fixture))
	return fixture
}

func TestNativeCombinedBoundaryProgress(t *testing.T) {
	fixture := loadCombinedBoundaryFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "combined-boundary")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(max(fixture.Fork.DescendantBlocks[len(fixture.Fork.DescendantBlocks)-1].Timestamp, fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp)))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, _ := GetClientState(store, cdc)
	ctx.Time = ctx.Time.Add(EpochContextChallengePeriod + 2*time.Nanosecond)
	// Even without protobuf metadata the first new-epoch anchor is too large.
	fullBytes := len(fixture.Header.AnchorBlock.BlockCbor)
	for _, block := range fixture.Header.BridgeBlocks {
		fullBytes += len(block.BlockCbor)
	}
	require.Greater(t, fullBytes, MaxHeaderBytes)
	for _, block := range fixture.Header.BridgeBlocks {
		require.LessOrEqual(t, len(block.BlockCbor), MaxBlockCBORBytes)
	}

	prefix := boundaryHeaderAtAnchor(t, fixture.Header, 966, 984)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, prefix))
	originalNonce := clonePraosNonceState(client.LatestCheckpointNonceState)
	originalProduction := clonePoolProduction(client.LatestCheckpointPoolProduction)
	require.Empty(t, client.UpdateState(ctx, cdc, store, prefix))
	client, _ = GetClientState(store, cdc)
	require.Equal(t, uint64(966), client.LatestCheckpointHeight.RevisionHeight)
	require.True(t, praosNonceStatesEqual(originalNonce, client.LatestCheckpointNonceState))
	require.True(t, poolProductionsEqual(originalProduction, client.LatestCheckpointPoolProduction))
	deadline := client.epochChallenge(8).UsableAfterUnixNs
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, prefix), ErrEpochContextPending)
	require.NoError(t, client.verifyEpochUsable(ctx, 7))
	// Independent native evidence remains verifiable during the proposal.
	fork := boundaryHeaderAtAnchor(t, fixture.Fork, 966, 984)
	evidence := NewMisbehaviour(ModuleName+"-0", prefix, fork)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, evidence))
	require.True(t, client.CheckForMisbehaviour(ctx, cdc, store, evidence))

	ctx.Time = time.Unix(0, int64(deadline)+2)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, prefix))
	client.UpdateState(ctx, cdc, store, prefix)
	client, _ = GetClientState(store, cdc)
	require.Equal(t, uint64(984), client.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, uint64(7), client.LatestCheckpointEpoch)
	require.Equal(t, uint64(7), client.LatestCheckpointPoolProduction.Epoch)
	require.Equal(t, deadline, client.epochChallenge(8).UsableAfterUnixNs)

	next := boundaryHeaderAtAnchor(t, fixture.Header, 984, 1001)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, next))
	client.UpdateState(ctx, cdc, store, next)
	client, _ = GetClientState(store, cdc)
	require.Equal(t, uint64(1001), client.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, uint64(8), client.LatestCheckpointEpoch)
	require.Equal(t, deadline, client.epochChallenge(8).UsableAfterUnixNs)
	// The original pre-proposal snapshot still authenticates the challenge.
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, evidence))
}

func TestCrossEpochSettlementFreezesQualificationAndDoesNotIncreaseCredit(t *testing.T) {
	current := &EpochContext{Epoch: 7, StakeDistribution: []*StakeDistributionEntry{
		{PoolId: "a", Stake: 2000}, {PoolId: "b", Stake: 2000}, {PoolId: "current-only", Stake: 2000}, {PoolId: "other", Stake: 4000},
	}}
	for i, entry := range current.StakeDistribution {
		entry.VrfKeyHash = bytes.Repeat([]byte{byte(i + 1)}, 32)
		entry.FirstRegistrationSlot = 1
	}
	next := &EpochContext{Epoch: 8, StakeDistribution: []*StakeDistributionEntry{
		{PoolId: "a", Stake: 100}, {PoolId: "b", Stake: 5000}, {PoolId: "new", Stake: 4900},
	}}
	header := &authenticatedProbabilisticHeader{
		anchorBlock:        &authenticatedProbabilisticBlock{height: 10, hash: "anchor", epoch: 7, slot: testMaturePoolSlot},
		anchorPoolRegistry: testPoolRegistry(7, current.StakeDistribution),
		anchorPoolProduction: &PoolProductionHistory{Epoch: 7, Pools: []*PoolProductionRecord{
			{PoolId: "a", CompletedEpochsBitmap: 1}, {PoolId: "b", CompletedEpochsBitmap: 1}, {PoolId: "current-only", ProducedCurrentEpoch: true},
		}},
	}
	prev := "anchor"
	for i, pool := range []string{"a", "a", "b", "current-only", "new", "b"} {
		hash := fmt.Sprint(i)
		header.descendantBlocks = append(header.descendantBlocks, &authenticatedProbabilisticBlock{height: uint64(11 + i), prevHash: prev, hash: hash, epoch: 8, slotLeader: pool})
		prev = hash
	}
	trusted := &trustedBlockState{epoch: 7, settlementCredit: mustTestSettlementCredit(current)}
	require.NoError(t, attachSettlementCredit(header, trusted, []*EpochContext{current, next}))
	pools, credit, _, err := newProbabilisticTestClientState().computeHeaderSecurityMetrics(header, current)
	require.NoError(t, err)
	require.Equal(t, uint64(2), pools)
	require.Equal(t, uint64(2100), credit) // 1% decrease plus unchanged 20%, not next epoch's 50%.
	require.Equal(t, uint64(7), header.anchorSettlementCredit.Epoch)
	require.Equal(t, uint64(7), header.anchorPoolProduction.Epoch)
	require.Equal(t, big.NewRat(1, 5), mustCreditValue(t, header.anchorSettlementCredit.Reference, "b"))
}

func mustCreditValue(t *testing.T, entries []*PoolSettlementCredit, pool string) *big.Rat {
	t.Helper()
	values, err := settlementCreditMap(entries)
	require.NoError(t, err)
	return values[pool]
}

func TestCrossEpochProposalDoesNotTrustNonceFromTemporaryTail(t *testing.T) {
	f, err := os.Open("../testdata/native-boundary-size.json.gz")
	require.NoError(t, err)
	defer f.Close()
	r, err := gzip.NewReader(f)
	require.NoError(t, err)
	defer r.Close()
	data, err := io.ReadAll(r)
	require.NoError(t, err)
	var fixture nativeBoundaryFixture
	require.NoError(t, json.Unmarshal(data, &fixture))
	first := boundaryHeaderAtAnchor(t, fixture.Header, 966, 976)
	alternate := boundaryHeaderAtAnchor(t, fixture.Fork, 966, 976)
	require.Equal(t, first.AnchorBlock.Hash, alternate.AnchorBlock.Hash)
	require.NotEqual(t, first.NewEpochContext.EpochNonce, alternate.NewEpochContext.EpochNonce)
	ctx, store := newProbabilisticTestClientStore(t, "temporary-nonce")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(max(fixture.Header.DescendantBlocks[29].Timestamp, fixture.Fork.DescendantBlocks[29].Timestamp)))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, _ := GetClientState(store, cdc)
	ctx.Time = ctx.Time.Add(EpochContextChallengePeriod + 2*time.Nanosecond)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, first))
	client.UpdateState(ctx, cdc, store, first)
	client, _ = GetClientState(store, cdc)
	ctx.Time = time.Unix(0, int64(client.epochChallenge(8).UsableAfterUnixNs)+2)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, alternate))
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, NewMisbehaviour(ModuleName+"-0", first, alternate)), ErrIBCInvalidMisbehaviour)
	client.UpdateState(ctx, cdc, store, alternate)
	client, _ = GetClientState(store, cdc)
	require.Equal(t, uint64(976), client.LatestCheckpointHeight.RevisionHeight)
	next := boundaryHeaderAtAnchor(t, fixture.Fork, 976, 1001)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, next))
}

func TestCrossEpochBodyReservationAppliesOnlyToForwardUpdates(t *testing.T) {
	fixture := loadCombinedBoundaryFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "challenge-body-reserve")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(max(fixture.Header.DescendantBlocks[29].Timestamp, fixture.Fork.DescendantBlocks[29].Timestamp)))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, _ := GetClientState(store, cdc)
	ctx.Time = ctx.Time.Add(EpochContextChallengePeriod + 2*time.Nanosecond)
	primary := boundaryHeaderAtAnchor(t, fixture.Header, 966, 990)
	witness := boundaryHeaderAtAnchor(t, fixture.Fork, 966, 987)
	require.ErrorContains(t, client.VerifyClientMessage(ctx, cdc, store, primary), "reserved challenge capacity")
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, NewMisbehaviour(ModuleName+"-0", primary, witness)))
}
