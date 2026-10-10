package state

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Explicit trusted test observations, never a production bootstrap from a table.
func testPoolProduction(context *EpochContext) *PoolProductionHistory {
	history := &PoolProductionHistory{Epoch: context.Epoch}
	for _, entry := range context.StakeDistribution {
		if entry != nil {
			record := &PoolProductionRecord{PoolId: entry.PoolId, CompletedEpochsBitmap: 1}
			if context.Epoch == 0 {
				record.CompletedEpochsBitmap, record.ProducedCurrentEpoch = 0, true
			}
			history.Pools = append(history.Pools, record)
		}
	}
	return history
}

func TestProductionExpiresAfterFiveCompletedEpochs(t *testing.T) {
	for _, distance := range []uint64{1, 5, 6, 64, ^uint64(0) - 10} {
		t.Run(fmt.Sprint(distance), func(t *testing.T) {
			records := map[string]*PoolProductionRecord{"pool-a": {PoolId: "pool-a", ProducedCurrentEpoch: true}}
			require.NoError(t, advanceProductionEpoch(records, 10, 10+distance))
			if distance <= 5 {
				require.Equal(t, uint32(1<<(distance-1)), records["pool-a"].CompletedEpochsBitmap)
				require.False(t, records["pool-a"].ProducedCurrentEpoch)
			} else {
				require.Empty(t, records)
			}
		})
	}
}

func TestProductionSettlementMatchesGatewayFixture(t *testing.T) {
	data, err := os.ReadFile("../testdata/pool-production-settlement.json")
	require.NoError(t, err)
	type observedBlock struct {
		Epoch uint64 `json:"epoch"`
		Pool  string `json:"pool"`
	}
	var cases []struct {
		Name           string                  `json:"name"`
		SavedEpoch     uint64                  `json:"saved_epoch"`
		Pools          []*PoolProductionRecord `json:"pools"`
		Bridge         []observedBlock         `json:"bridge"`
		Anchor         observedBlock           `json:"anchor"`
		Descendants    []string                `json:"descendants"`
		ExpectedPools  uint64                  `json:"expected_pools"`
		ExpectedCredit uint64                  `json:"expected_credit_bps"`
	}
	require.NoError(t, json.Unmarshal(data, &cases))
	for _, fixture := range cases {
		t.Run(fixture.Name, func(t *testing.T) {
			saved := &PoolProductionHistory{Epoch: fixture.SavedEpoch, Pools: fixture.Pools}
			trusted := &trustedBlockState{epoch: fixture.SavedEpoch, poolProduction: saved}
			header := &authenticatedProbabilisticHeader{
				anchorBlock:            &authenticatedProbabilisticBlock{height: 10, hash: "anchor", epoch: fixture.Anchor.Epoch, slotLeader: fixture.Anchor.Pool},
				anchorSettlementCredit: &SettlementCreditState{Epoch: fixture.Anchor.Epoch, Reference: []*PoolSettlementCredit{testCredit("pool-a", 1, 5000), testCredit("other", 4999, 5000)}},
			}
			for _, block := range fixture.Bridge {
				header.bridgeBlocks = append(header.bridgeBlocks, &authenticatedProbabilisticBlock{epoch: block.Epoch, slotLeader: block.Pool})
			}
			previous := "anchor"
			for i, pool := range fixture.Descendants {
				hash := fmt.Sprintf("block-%d", i)
				header.descendantBlocks = append(header.descendantBlocks, &authenticatedProbabilisticBlock{height: uint64(11 + i), hash: hash, prevHash: previous, epoch: fixture.Anchor.Epoch, slotLeader: pool})
				previous = hash
			}
			context := &EpochContext{Epoch: fixture.Anchor.Epoch, StakeDistribution: []*StakeDistributionEntry{
				{PoolId: "pool-a", Stake: 2000, VrfKeyHash: bytes.Repeat([]byte{1}, 32)},
				{PoolId: "other", Stake: 8000, VrfKeyHash: bytes.Repeat([]byte{2}, 32)},
			}}
			header.anchorPoolRegistry = testPoolRegistry(context.Epoch, context.StakeDistribution)
			require.NoError(t, attachPoolProduction(header, trusted))
			count, credit, _, err := newProbabilisticTestClientState().computeHeaderSecurityMetrics(header, context)
			require.NoError(t, err)
			require.Equal(t, fixture.ExpectedPools, count)
			require.Equal(t, fixture.ExpectedCredit, credit)
			if fixture.ExpectedPools == 0 {
				header.anchorPoolProduction = &PoolProductionHistory{Epoch: context.Epoch}
				count, credit, _, err = newProbabilisticTestClientState().computeHeaderSecurityMetrics(header, context)
				require.NoError(t, err)
				require.Zero(t, count)
				require.Zero(t, credit)
			}
		})
	}
}

func TestProductionRecordsCommittedBlocksAndIsolatesDescendants(t *testing.T) {
	trusted := &trustedBlockState{epoch: 10, poolProduction: &PoolProductionHistory{Epoch: 10}}
	header := &authenticatedProbabilisticHeader{
		bridgeBlocks:     []*authenticatedProbabilisticBlock{{epoch: 10, slotLeader: "pool-a"}, {epoch: 10, slotLeader: "pool-a"}},
		anchorBlock:      &authenticatedProbabilisticBlock{epoch: 10, slotLeader: "pool-b"},
		descendantBlocks: []*authenticatedProbabilisticBlock{{epoch: 10, slotLeader: "pool-c"}},
	}
	require.NoError(t, attachPoolProduction(header, trusted))
	records, err := productionRecordMap(header.anchorPoolProduction, 10)
	require.NoError(t, err)
	require.Len(t, records, 2)
	require.True(t, records["pool-a"].ProducedCurrentEpoch)
	require.Zero(t, records["pool-a"].CompletedEpochsBitmap)
	require.NotContains(t, records, "pool-c")
	require.Empty(t, trusted.poolProduction.Pools)
	// Incorporating the earlier descendant at a later committed anchor records
	// its production, even though its current-only history cannot qualify it yet.
	next := &authenticatedProbabilisticHeader{anchorBlock: header.descendantBlocks[0]}
	require.NoError(t, attachPoolProduction(next, &trustedBlockState{epoch: 10, poolProduction: header.anchorPoolProduction}))
	current, err := productionRecordMap(next.anchorPoolProduction, 10)
	require.NoError(t, err)
	require.True(t, current["pool-c"].ProducedCurrentEpoch)
	require.Zero(t, current["pool-c"].CompletedEpochsBitmap)
	rollover := &authenticatedProbabilisticHeader{anchorBlock: &authenticatedProbabilisticBlock{epoch: 11, slotLeader: "pool-d"}}
	require.NoError(t, attachPoolProduction(rollover, &trustedBlockState{epoch: 10, poolProduction: next.anchorPoolProduction}))
	completed, err := productionRecordMap(rollover.anchorPoolProduction, 11)
	require.NoError(t, err)
	for _, pool := range []string{"pool-a", "pool-b", "pool-c"} {
		require.Equal(t, uint32(1), completed[pool].CompletedEpochsBitmap)
		require.False(t, completed[pool].ProducedCurrentEpoch)
	}
	require.Zero(t, completed["pool-d"].CompletedEpochsBitmap)
}

func TestProductionPersistsAtOrdinaryAndRootlessAnchors(t *testing.T) {
	for _, checkpoint := range []bool{false, true} {
		t.Run(fmt.Sprint(checkpoint), func(t *testing.T) {
			context := newTemporalVerifierEpochContext(7, 0, 1000, 7)
			ctx, cdc, store, client := initializeTemporalVerifierClient(t, "production-checkpoint", 100, context)
			ctx = ctx.WithBlockTime(time.Unix(0, int64(mustTestTimestampForSlot(t, client, 150))))
			header := newTemporalVerifierHeader(t, client, "production-anchor", 11, 101, 7, checkpoint)
			authenticated := newTemporalVerifierAuthenticatedHeader(t, client, client.LatestCheckpointBlockHash, header.AnchorBlock.Hash, 11, 101, 7)
			authenticate := temporalVerifierAuthenticator(t, map[string]*authenticatedProbabilisticHeader{header.AnchorBlock.Hash: authenticated})
			require.NoError(t, client.verifyHeaderWithAuthenticator(ctx, store, cdc, header, authenticate))
			heights := client.updateStateWithAuthenticator(ctx, cdc, store, header, authenticate)
			if checkpoint {
				require.Empty(t, heights)
			} else {
				require.Len(t, heights, 1)
				consensus, found := GetConsensusState(store, cdc, NewHeight(0, 11))
				require.True(t, found)
				require.True(t, poolProductionsEqual(client.LatestCheckpointPoolProduction, consensus.PoolProduction))
			}
			saved, found := GetClientState(store, cdc)
			require.True(t, found)
			records, err := productionRecordMap(saved.LatestCheckpointPoolProduction, 7)
			require.NoError(t, err)
			require.True(t, records["pool-a"].ProducedCurrentEpoch)
			// These pools appeared only among temporary descendants. Their old
			// completed bits remain, but no current production is persisted.
			for _, pool := range []string{"pool-b", "pool-c", "pool-d", "pool-e"} {
				require.False(t, records[pool].ProducedCurrentEpoch)
			}
		})
	}
}

func TestProductionRejectsMissingAndMalformedHistory(t *testing.T) {
	_, err := productionRecordMap(nil, 10)
	require.ErrorContains(t, err, "authenticate history")
	for _, records := range [][]*PoolProductionRecord{
		{nil}, {{PoolId: "pool-a"}}, {{PoolId: "POOL", CompletedEpochsBitmap: 1}},
		{{PoolId: "pool-a", CompletedEpochsBitmap: 32}},
		{{PoolId: "pool-a", CompletedEpochsBitmap: 1}, {PoolId: "pool-a", CompletedEpochsBitmap: 1}},
	} {
		_, err := productionRecordMap(&PoolProductionHistory{Epoch: 10, Pools: records}, 10)
		require.Error(t, err)
	}
	_, err = productionRecordMap(&PoolProductionHistory{Epoch: 0, Pools: []*PoolProductionRecord{{PoolId: "pool-a", CompletedEpochsBitmap: 1}}}, 0)
	require.Error(t, err)
}
