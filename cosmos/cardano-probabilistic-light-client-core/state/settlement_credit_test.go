package state

import (
	"bytes"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func mustTestSettlementCredit(context *EpochContext) *SettlementCreditState {
	s, err := bootstrapSettlementCredit(context)
	if err != nil {
		panic(err)
	}
	return s
}

func testCredit(pool string, numerator, denominator int64) *PoolSettlementCredit {
	q := big.NewRat(numerator, denominator)
	return &PoolSettlementCredit{PoolId: pool, Numerator: q.Num().Bytes(), Denominator: q.Denom().Bytes()}
}

func TestSettlementCreditClipsIncreasesAndKeepsDecreases(t *testing.T) {
	context := &EpochContext{Epoch: 7, StakeDistribution: []*StakeDistributionEntry{
		{PoolId: "increased", Stake: 2000}, {PoolId: "decreased", Stake: 100},
		{PoolId: "new", Stake: 2000}, {PoolId: "other", Stake: 5900},
	}}
	reference := &SettlementCreditState{Epoch: 7, Reference: []*PoolSettlementCredit{
		testCredit("increased", 1, 5000), testCredit("decreased", 1, 5), testCredit("other", 3999, 5000),
	}}
	credits, err := currentSettlementCredits(reference, context)
	require.NoError(t, err)
	require.Zero(t, credits["increased"].Cmp(big.NewRat(26, 5000))) // 0.02% + 0.5 points
	require.Zero(t, credits["decreased"].Cmp(big.NewRat(1, 100)))
	require.Zero(t, credits["new"].Cmp(big.NewRat(1, 200)))
	total := new(big.Rat)
	for _, credit := range credits {
		total.Add(total, credit)
	}
	require.Zero(t, total.Cmp(big.NewRat(3051, 5000))) // 61.02%, never renormalized
	require.Equal(t, uint64(6102), settlementCreditBps(total))
	// Calculating credit never changes the share used for leader eligibility.
	require.Equal(t, uint64(2000), context.StakeDistribution[0].Stake)
}

func TestSettlementReferenceAdvancesOnlyOncePerEpochFromCappedCredit(t *testing.T) {
	context := &EpochContext{Epoch: 7, StakeDistribution: []*StakeDistributionEntry{{PoolId: "pool", Stake: 2000}, {PoolId: "other", Stake: 8000}}}
	s := &SettlementCreditState{Epoch: 7, Reference: []*PoolSettlementCredit{testCredit("pool", 1, 5000), testCredit("other", 4999, 5000)}}
	trusted := &trustedBlockState{epoch: 7, settlementCredit: s}
	for range 10 {
		same, err := advanceSettlementCredit(trusted, []*EpochContext{context}, 7)
		require.NoError(t, err)
		require.True(t, settlementCreditsEqual(s, same))
		trusted.settlementCredit = same
	}
	next, err := advanceSettlementCredit(trusted, []*EpochContext{context}, 8)
	require.NoError(t, err)
	shares, err := settlementCreditMap(next.Reference)
	require.NoError(t, err)
	require.Zero(t, shares["pool"].Cmp(big.NewRat(26, 5000)))
	context8 := cloneEpochContext(context)
	context8.Epoch = 8
	credits, err := currentSettlementCredits(next, context8)
	require.NoError(t, err)
	require.Zero(t, credits["pool"].Cmp(big.NewRat(51, 5000))) // 1.02%, not claimed 20%
	_, err = advanceSettlementCredit(trusted, []*EpochContext{context}, 9)
	require.ErrorContains(t, err, "adjacent epoch")
	_, err = advanceSettlementCredit(trusted, nil, 8)
	require.ErrorContains(t, err, "context is missing")
	require.Zero(t, shares["other"].Cmp(big.NewRat(4, 5))) // decrease is retained immediately
}

func TestSettlementCreditCountsDistinctEligibleProducersWithoutRenormalizing(t *testing.T) {
	for _, poolCount := range []int{5, 11} {
		t.Run(fmt.Sprint(poolCount), func(t *testing.T) {
			cs := newProbabilisticTestClientState()
			context := &EpochContext{Epoch: 7}
			for i := range poolCount {
				context.StakeDistribution = append(context.StakeDistribution, &StakeDistributionEntry{PoolId: fmt.Sprintf("pool-%d", i), Stake: 1000, VrfKeyHash: bytes.Repeat([]byte{1}, 32)})
			}
			header := &authenticatedProbabilisticHeader{
				anchorBlock:            &authenticatedProbabilisticBlock{height: 10, hash: "anchor", epoch: 7},
				anchorPoolRegistry:     testPoolRegistry(7, context.StakeDistribution),
				anchorSettlementCredit: &SettlementCreditState{Epoch: 7},
				anchorPoolProduction:   testPoolProduction(context),
			}
			previous := "anchor"
			for i := range 24 {
				hash := fmt.Sprintf("block-%d", i)
				header.descendantBlocks = append(header.descendantBlocks, &authenticatedProbabilisticBlock{
					height: uint64(11 + i), hash: hash, prevHash: previous, epoch: 7, slotLeader: fmt.Sprintf("pool-%d", i%poolCount),
				})
				previous = hash
			}
			count, credit, _, err := cs.computeHeaderSecurityMetrics(header, context)
			require.NoError(t, err)
			require.Equal(t, uint64(poolCount), count)
			require.Equal(t, uint64(poolCount)*50, credit)
			require.Equal(t, poolCount >= 11, credit >= DefaultThresholdUniqueStakeBps)
		})
	}
}

func TestSettlementCreditRoundsOnlyTheAggregate(t *testing.T) {
	context := &EpochContext{Epoch: 7, StakeDistribution: []*StakeDistributionEntry{
		{PoolId: "a", Stake: 511}, {PoolId: "b", Stake: 511}, {PoolId: "c", Stake: 511}, {PoolId: "other", Stake: 28467},
	}}
	credits, err := currentSettlementCredits(mustTestSettlementCredit(context), context)
	require.NoError(t, err)
	total := new(big.Rat).Add(credits["a"], credits["b"])
	total.Add(total, credits["c"])
	require.Equal(t, uint64(511), settlementCreditBps(total))
}

func TestSettlementCreditSurvivesCheckpointUpdatesAndKeepsHistoricalReference(t *testing.T) {
	base := newTemporalVerifierEpochContext(7, 0, 1_000, 7)
	for i, stake := range []uint64{2, 2499, 2499, 2500, 2500} {
		entry := base.StakeDistribution[i]
		entry.Stake = stake
		entry.RelativeStakeNumerator, entry.RelativeStakeDenominator = stake, 10_000
	}
	ctx, cdc, store, cs := initializeTemporalVerifierClient(t, "settlement-credit-checkpoints", 999, base)
	initial := cloneSettlementCredit(cs.LatestCheckpointSettlementCredit)
	for i, point := range []struct{ epoch, slot uint64 }{{8, 1000}, {8, 1001}, {9, 2000}} {
		height := uint64(11 + i)
		ctx = ctx.WithBlockTime(time.Unix(0, int64(mustTestTimestampForSlot(t, cs, point.slot+24))))
		header := newTemporalVerifierHeader(t, cs, "checkpoint", height, point.slot, point.epoch, true)
		header.TrustedHeight = cs.LatestCheckpointHeight
		full := makeTestProbabilisticBlock(t, height, point.slot, cs.LatestCheckpointBlockHash)
		header.AnchorBlock.BlockCbor, header.AnchorBlock.Hash = full.BlockCbor, full.Hash
		if point.epoch != cs.CurrentEpoch {
			header.NewEpochContext = newTemporalVerifierEpochContext(point.epoch, (point.epoch-7)*1000, (point.epoch-6)*1000, byte(point.epoch))
		}
		authenticated := newTemporalVerifierAuthenticatedHeader(t, cs, cs.LatestCheckpointBlockHash, full.Hash, height, point.slot, point.epoch)
		authenticate := temporalVerifierAuthenticator(t, map[string]*authenticatedProbabilisticHeader{full.Hash: authenticated})
		require.NoError(t, cs.verifyHeaderWithAuthenticator(ctx, store, cdc, header, authenticate))
		require.Empty(t, cs.updateStateWithAuthenticator(ctx, cdc, store, header, authenticate))
		var found bool
		cs, found = GetClientState(store, cdc)
		require.True(t, found)
		reference, err := settlementCreditMap(cs.LatestCheckpointSettlementCredit.Reference)
		require.NoError(t, err)
		expected := big.NewRat(1, 5000)
		if point.epoch == 9 {
			expected = big.NewRat(26, 5000)
		}
		require.Zero(t, reference["pool-a"].Cmp(expected))
		require.Equal(t, point.epoch, cs.LatestCheckpointSettlementCredit.Epoch)
	}
	// The rootless cursor advances, but an older consensus point retains its
	// original reference for historical verification instead of inheriting it.
	historical, err := cs.trustedBlockStateAtHeight(store, cdc, NewHeight(0, 10))
	require.NoError(t, err)
	require.True(t, settlementCreditsEqual(initial, historical.settlementCredit))
	history, err := productionRecordMap(historical.poolProduction, 7)
	require.NoError(t, err)
	require.False(t, history["pool-a"].ProducedCurrentEpoch)
	require.Equal(t, uint32(1), history["pool-a"].CompletedEpochsBitmap)
	latest, err := cs.latestTrustedBlockState(store, cdc)
	require.NoError(t, err)
	require.True(t, settlementCreditsEqual(cs.LatestCheckpointSettlementCredit, latest.settlementCredit))
	latestHistory, err := productionRecordMap(latest.poolProduction, 9)
	require.NoError(t, err)
	require.True(t, latestHistory["pool-a"].ProducedCurrentEpoch)
	require.Equal(t, uint32(5), latestHistory["pool-a"].CompletedEpochsBitmap)
}

func TestSettlementCreditRejectsMissingOrMalformedReference(t *testing.T) {
	require.ErrorContains(t, validateSettlementCredit(nil, 7), "migration")
	for _, entries := range [][]*PoolSettlementCredit{
		{nil}, {testCredit("POOL", 1, 10)}, {testCredit("pool", 1, 10), testCredit("pool", 1, 10)},
		{{PoolId: "pool", Numerator: []byte{2}, Denominator: []byte{4}}},
		{{PoolId: "pool", Numerator: []byte{0, 1}, Denominator: []byte{2}}},
		{testCredit("pool", 2, 1)}, {testCredit("a", 3, 4), testCredit("b", 3, 4)},
	} {
		_, err := settlementCreditMap(entries)
		require.Error(t, err)
	}
}
