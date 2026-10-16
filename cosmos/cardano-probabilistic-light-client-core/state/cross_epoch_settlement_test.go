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
	pools, credit, err := newProbabilisticTestClientState().computeHeaderSecurityMetrics(header, current)
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
