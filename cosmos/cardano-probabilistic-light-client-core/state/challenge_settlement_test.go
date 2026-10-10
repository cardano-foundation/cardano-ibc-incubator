package state

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHistoricalChallengeCreditMatchesHermesGatewayRequest(t *testing.T) {
	data, err := os.ReadFile("../testdata/challenge-settlement.json")
	require.NoError(t, err)
	var fixture struct {
		Epoch       uint64   `json:"historical_epoch"`
		PoolIDs     []string `json:"pool_ids"`
		Short       []string `json:"short_descendants"`
		Long        []string `json:"long_descendants"`
		ShortCredit uint64   `json:"expected_short_credit_bps"`
		LongCredit  uint64   `json:"expected_long_credit_bps"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	context := &EpochContext{Epoch: fixture.Epoch}
	history := &PoolProductionHistory{Epoch: fixture.Epoch}
	for i, pool := range fixture.PoolIDs {
		context.StakeDistribution = append(context.StakeDistribution, &StakeDistributionEntry{
			PoolId: pool, Stake: 200, FirstRegistrationSlot: 1,
			VrfKeyHash:             bytes.Repeat([]byte{byte(i + 1)}, 32),
			RelativeStakeNumerator: 1, RelativeStakeDenominator: 50,
		})
		history.Pools = append(history.Pools, &PoolProductionRecord{PoolId: pool, CompletedEpochsBitmap: 1})
	}
	context.StakeDistribution = append(context.StakeDistribution, &StakeDistributionEntry{
		PoolId: "other", Stake: 7800, FirstRegistrationSlot: 1, VrfKeyHash: bytes.Repeat([]byte{12}, 32),
		RelativeStakeNumerator: 39, RelativeStakeDenominator: 50,
	})
	for _, test := range []struct {
		name      string
		producers []string
		credit    uint64
		settles   bool
	}{
		{"five producers", fixture.Short, fixture.ShortCredit, false},
		{"eleven producers", fixture.Long, fixture.LongCredit, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			// These are the same authenticated issuer observations that Gateway
			// selects in its wire-request test. Header cryptography is exercised
			// separately. Here the core repeats qualification and exact credit.
			header := &authenticatedProbabilisticHeader{
				anchorBlock:            &authenticatedProbabilisticBlock{height: 100, hash: "anchor", epoch: fixture.Epoch, slot: 1000, slotLeader: "pool-a"},
				anchorPoolRegistry:     testPoolRegistry(fixture.Epoch, context.StakeDistribution),
				anchorSettlementCredit: &SettlementCreditState{Epoch: fixture.Epoch},
			}
			previous := "anchor"
			for i, pool := range test.producers {
				hash := fmt.Sprintf("block-%d", i)
				header.descendantBlocks = append(header.descendantBlocks, &authenticatedProbabilisticBlock{
					height: uint64(101 + i), hash: hash, prevHash: previous, epoch: fixture.Epoch, slot: uint64(1010 + 10*i), slotLeader: pool,
				})
				previous = hash
			}
			require.NoError(t, attachPoolProduction(header, &trustedBlockState{epoch: fixture.Epoch, poolProduction: history}))
			count, credit, _, err := newProbabilisticTestClientState().computeHeaderSecurityMetrics(header, context)
			require.NoError(t, err)
			require.Equal(t, test.credit, credit)
			require.Equal(t, test.settles, uint64(len(test.producers)) >= DefaultThresholdDepth && count >= DefaultThresholdUniquePools && credit >= DefaultThresholdUniqueStakeBps)
		})
	}
}
