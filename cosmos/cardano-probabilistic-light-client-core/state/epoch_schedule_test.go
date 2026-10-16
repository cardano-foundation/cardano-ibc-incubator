package state

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEpochScheduleUsesTrustedSlotOffset(t *testing.T) {
	// Mainnet's Shelley epoch 208 starts after 208 Byron epochs of 21,600
	// slots. Later epochs use 432,000 slots. An anchor in the supported eras
	// must preserve this offset rather than multiply the epoch by its length.
	cs := newProbabilisticTestClientState()
	cs.CurrentEpoch = 365
	cs.CurrentEpochStartSlot = 208*21_600 + (365-208)*432_000
	cs.CurrentEpochEndSlotExclusive = cs.CurrentEpochStartSlot + 432_000
	for _, tc := range []struct {
		slot, epoch, start, end uint64
	}{
		{72_316_799, 364, 71_884_800, 72_316_800},
		{72_316_800, 365, 72_316_800, 72_748_800},
		{72_748_799, 365, 72_316_800, 72_748_800},
		{72_748_800, 366, 72_748_800, 73_180_800},
		{73_180_800, 367, 73_180_800, 73_612_800},
	} {
		epoch, err := cs.epochForSlot(tc.slot)
		require.NoError(t, err)
		require.Equal(t, tc.epoch, epoch)
		start, end, err := cs.epochSlotBounds(epoch)
		require.NoError(t, err)
		require.Equal(t, tc.start, start)
		require.Equal(t, tc.end, end)
	}
}

func TestEpochScheduleSupportsCustomNetworkLength(t *testing.T) {
	cs := newProbabilisticTestClientState()
	cs.CurrentEpoch = 12
	cs.CurrentEpochStartSlot = 65_000
	cs.CurrentEpochEndSlotExclusive = 70_000
	for _, tc := range []struct{ slot, epoch uint64 }{
		{59_999, 10}, {60_000, 11}, {65_000, 12}, {69_999, 12}, {70_000, 13},
	} {
		epoch, err := cs.epochForSlot(tc.slot)
		require.NoError(t, err)
		require.Equal(t, tc.epoch, epoch)
	}
}

func TestEpochContextRejectsChangesToDerivedFields(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*EpochContext)
	}{
		{"epoch", func(ctx *EpochContext) { ctx.Epoch++ }},
		{"start", func(ctx *EpochContext) { ctx.EpochStartSlot++ }},
		{"end", func(ctx *EpochContext) { ctx.EpochEndSlotExclusive++ }},
		{"shifted window", func(ctx *EpochContext) { ctx.EpochStartSlot++; ctx.EpochEndSlotExclusive++ }},
		{"KES period", func(ctx *EpochContext) { ctx.SlotsPerKesPeriod++ }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := newProbabilisticTestClientState()
			ctx := cloneEpochContext(cs.EpochContexts[0])
			tc.mutate(ctx)
			require.Error(t, cs.validateEpochContextParameters([]*EpochContext{ctx}))
		})
	}
}

func TestEpochContextRejectsOverlapAndChangedLengthAtRollover(t *testing.T) {
	for _, tc := range []struct {
		name       string
		start, end uint64
	}{
		{"overlap", 999_999, 1_999_999},
		{"gap", 1_000_001, 2_000_001},
		{"longer epoch", 1_000_000, 2_000_001},
		{"shorter epoch", 1_000_000, 1_999_999},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := newProbabilisticTestClientState()
			ctx := cloneEpochContext(cs.EpochContexts[0])
			ctx.Epoch++
			ctx.EpochStartSlot = tc.start
			ctx.EpochEndSlotExclusive = tc.end
			require.ErrorContains(t, cs.validateEpochContextParameters([]*EpochContext{ctx}), "must match stored schedule")
		})
	}
}

func TestEpochScheduleSurvivesRolloverAndRetainedContexts(t *testing.T) {
	cs := newProbabilisticTestClientState()
	previous := cloneEpochContext(cs.EpochContexts[0])
	next := cloneEpochContext(previous)
	next.Epoch++
	next.EpochStartSlot = 1_000_000
	next.EpochEndSlotExclusive = 2_000_000
	require.NoError(t, syncCurrentEpochFields(cs, []*EpochContext{previous, next}, next.Epoch))
	cs.LatestCheckpointPoolRegistry = testPoolRegistryAtEpoch(t, cs.LatestCheckpointPoolRegistry, next.Epoch)
	cs.LatestCheckpointSettlementCredit = mustTestSettlementCredit(next)
	cs.LatestCheckpointPoolProduction = testPoolProduction(next)
	setTestCheckpoint(t, cs, cs.LatestHeight, cs.LatestCheckpointBlockHash, cs.CurrentEpoch, next.EpochStartSlot)
	require.NoError(t, validateBootstrapInput(*cs))
	start, end, err := cs.epochSlotBounds(previous.Epoch)
	require.NoError(t, err)
	require.Equal(t, previous.EpochStartSlot, start)
	require.Equal(t, previous.EpochEndSlotExclusive, end)
	epoch, err := cs.epochForSlot(2_000_000)
	require.NoError(t, err)
	require.Equal(t, next.Epoch+1, epoch)
}

func TestEpochScheduleRejectsInvalidOrUnrepresentableBounds(t *testing.T) {
	for _, tc := range []struct {
		name        string
		cs          ClientState
		epoch, slot uint64
	}{
		{"empty window", ClientState{CurrentEpoch: 1, CurrentEpochStartSlot: 5, CurrentEpochEndSlotExclusive: 5}, 1, 5},
		{"reversed window", ClientState{CurrentEpoch: 1, CurrentEpochStartSlot: 6, CurrentEpochEndSlotExclusive: 5}, 1, 5},
		{"negative start", ClientState{CurrentEpoch: 1, CurrentEpochStartSlot: 5, CurrentEpochEndSlotExclusive: 15}, 0, 4},
		{"negative epoch", ClientState{CurrentEpoch: 0, CurrentEpochStartSlot: 10, CurrentEpochEndSlotExclusive: 20}, 0, 9},
		{"overflowing end", ClientState{CurrentEpoch: 1, CurrentEpochStartSlot: math.MaxUint64 - 10, CurrentEpochEndSlotExclusive: math.MaxUint64}, 2, math.MaxUint64},
		{"overflowing epoch", ClientState{CurrentEpoch: math.MaxUint64, CurrentEpochEndSlotExclusive: 10}, 0, 10},
		{"overflowing product", ClientState{CurrentEpochEndSlotExclusive: math.MaxUint64 / 2}, math.MaxUint64, math.MaxUint64},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tc.cs.epochForSlot(tc.slot)
			require.Error(t, err)
			if tc.name != "negative epoch" && tc.name != "overflowing epoch" {
				_, _, err = tc.cs.epochSlotBounds(tc.epoch)
				require.Error(t, err)
			}
		})
	}
}

func TestSignedBlockRejectsSuppliedEpochScheduleChanges(t *testing.T) {
	for _, compact := range []bool{false, true} {
		for _, tc := range []struct {
			name   string
			mutate func(*ProbabilisticBlock, *EpochContext)
			want   string
		}{
			{"relabelled epoch", func(block *ProbabilisticBlock, ctx *EpochContext) {
				block.Epoch++
				ctx.Epoch++
			}, "block epoch mismatch"},
			{"shifted start", func(_ *ProbabilisticBlock, ctx *EpochContext) {
				ctx.EpochStartSlot--
			}, "must match stored schedule"},
			{"shifted end", func(_ *ProbabilisticBlock, ctx *EpochContext) {
				ctx.EpochEndSlotExclusive++
			}, "must match stored schedule"},
			{"KES period", func(_ *ProbabilisticBlock, ctx *EpochContext) {
				ctx.SlotsPerKesPeriod++
			}, "must match immutable client value"},
		} {
			t.Run(tc.name+map[bool]string{false: "/full block", true: "/header"}[compact], func(t *testing.T) {
				fixture := loadBabbageWitnessFixture(t)
				block := cloneTestProbabilisticBlock(fixture.block)
				if compact {
					block.BlockCbor = nil
					block.HeaderCbor = fixture.headerCbor
				}
				// Establish that the untouched signature and VRF evidence is valid.
				_, err := fixture.clientState.authenticateProbabilisticBlock(block, "bridge", []*EpochContext{fixture.epochContext}, map[string]uint64{}, false, testNonceTracker(t, block, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, block, []*EpochContext{fixture.epochContext}))
				require.NoError(t, err)
				tc.mutate(block, fixture.epochContext)
				_, err = fixture.clientState.authenticateProbabilisticBlock(block, "bridge", []*EpochContext{fixture.epochContext}, map[string]uint64{}, false, testNonceTracker(t, block, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, block, []*EpochContext{fixture.epochContext}))
				require.ErrorContains(t, err, tc.want)
			})
		}
	}
}
