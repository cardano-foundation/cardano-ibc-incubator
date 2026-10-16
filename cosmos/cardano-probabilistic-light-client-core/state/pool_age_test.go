package state

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

// Twenty million one-second slots give settlement fixtures more than six months
// of registration history while keeping their local block gaps small.
const testMaturePoolSlot uint64 = 20_000_000

func TestPoolAgeMatchesGatewayCalendarAndSettlement(t *testing.T) {
	data, err := os.ReadFile("../testdata/pool-age.json")
	require.NoError(t, err)
	var cases []struct {
		Name            string   `json:"name"`
		SystemStart     string   `json:"system_start_unix_ns"`
		SlotLength      string   `json:"slot_length_ns"`
		AnchorSlot      string   `json:"anchor_slot"`
		AnchorTimestamp string   `json:"anchor_timestamp_unix_ns"`
		CutoffSlot      string   `json:"expected_cutoff_slot"`
		Registrations   []string `json:"registration_slots"`
		Pools           uint64   `json:"expected_pools"`
		Credit          uint64   `json:"expected_credit_bps"`
	}
	require.NoError(t, json.Unmarshal(data, &cases))
	parse := func(s string) uint64 {
		n, err := strconv.ParseUint(s, 10, 64)
		require.NoError(t, err)
		return n
	}
	for _, fixture := range cases {
		t.Run(fixture.Name, func(t *testing.T) {
			cs := newProbabilisticTestClientState()
			cs.SystemStartUnixNs, cs.SlotLengthNs = parse(fixture.SystemStart), parse(fixture.SlotLength)
			anchorSlot := parse(fixture.AnchorSlot)
			cutoff, err := cs.poolRegistrationCutoffSlotExclusive(anchorSlot)
			require.NoError(t, err)
			require.Equal(t, parse(fixture.CutoffSlot), cutoff)
			timestamp, err := cs.DeriveTimestampFromSlot(anchorSlot)
			require.NoError(t, err)
			require.Equal(t, parse(fixture.AnchorTimestamp), timestamp)
			context := &EpochContext{Epoch: 7}
			header := &authenticatedProbabilisticHeader{anchorBlock: &authenticatedProbabilisticBlock{height: 10, hash: "anchor", epoch: 7, slot: anchorSlot}}
			previous := "anchor"
			for i, registration := range fixture.Registrations {
				pool := string(rune('a' + i))
				context.StakeDistribution = append(context.StakeDistribution, &StakeDistributionEntry{
					PoolId: pool, Stake: 100, VrfKeyHash: bytes.Repeat([]byte{byte(i + 1)}, 32), FirstRegistrationSlot: parse(registration),
				})
				header.descendantBlocks = append(header.descendantBlocks, &authenticatedProbabilisticBlock{
					height: uint64(11 + i), hash: pool, prevHash: previous, epoch: 7, slotLeader: pool,
				})
				previous = pool
			}
			header.anchorPoolRegistry = testPoolRegistry(7, context.StakeDistribution)
			header.anchorSettlementCredit = mustTestSettlementCredit(context)
			header.anchorPoolProduction = testPoolProduction(context)
			// Replay this historical anchor after an arbitrarily newer checkpoint.
			// Neither the latest checkpoint nor descendant times can age producers.
			cs.LatestCheckpointSlot, cs.LatestCheckpointTimestamp = math.MaxUint64, math.MaxUint64
			header.descendantBlocks[2].timestamp = math.MaxUint64
			pools, credit, err := cs.computeHeaderSecurityMetrics(header, context)
			require.NoError(t, err)
			require.Equal(t, fixture.Pools, pools)
			require.Equal(t, fixture.Credit, credit)
		})
	}
}

func TestPoolAgeRejectsInvalidTiming(t *testing.T) {
	for _, cs := range []*ClientState{nil, {}, {SystemStartUnixNs: 1}, {SlotLengthNs: 1}, {SystemStartUnixNs: 1, SlotLengthNs: math.MaxUint64}} {
		_, err := cs.poolRegistrationCutoffSlotExclusive(2)
		require.ErrorIs(t, err, ErrInvalidTimestamp)
	}
}
