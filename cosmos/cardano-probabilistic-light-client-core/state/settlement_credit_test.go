package state

import (
	"bytes"
	"fmt"
	"math/big"
	"testing"

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
				anchorBlock:            &authenticatedProbabilisticBlock{height: 10, hash: "anchor", epoch: 7, slot: testMaturePoolSlot},
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
			count, credit, err := cs.computeHeaderSecurityMetrics(header, context)
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
