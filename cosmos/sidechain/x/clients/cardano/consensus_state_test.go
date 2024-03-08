package cardano_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	cardano "sidechain/x/clients/cardano"
)

func TestConsensusStateValidateBasic(t *testing.T) {
	testCases := []struct {
		name           string
		consensusState cardano.ConsensusState
		expPass        bool
	}{
		{
			"Success: ConsensusState",
			cardano.ConsensusState{
				Timestamp: uint64(time.Now().UnixNano()),
				Slot:      123,
			},
			true,
		},
		{
			"Failed: ConsensusState with slot == 0",
			cardano.ConsensusState{
				Timestamp: uint64(time.Now().UnixNano()),
				Slot:      0,
			},
			false,
		},
		{
			"Failed: ConsensusState with Timestamp == 0",
			cardano.ConsensusState{
				Timestamp: uint64(0),
				Slot:      123,
			},
			false,
		},
	}

	for _, tc := range testCases {
		tc := tc

		t.Run(tc.name, func(t *testing.T) {
			cs := tc.consensusState
			err := cs.ValidateBasic()
			if tc.expPass {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestConsensusStateTime(t *testing.T) {
	testCases := []struct {
		name           string
		consensusState cardano.ConsensusState
		expTimeStamp   uint64
		expTime        time.Time
		expSlot        uint64
		expClientType  string
	}{
		{
			"Success: ConsensusState",
			cardano.ConsensusState{
				Timestamp: 1707122673,
				Slot:      123,
			},
			1707122673 * 1e9,
			time.Unix(1707122673, 0),
			123,
			cardano.ModuleName,
		},
	}

	for _, tc := range testCases {
		tc := tc

		t.Run(tc.name, func(t *testing.T) {
			cs := tc.consensusState
			timestamp := cs.GetTimestamp()
			cs_time := cs.GetTime()
			require.Equal(t, tc.expTimeStamp, timestamp)
			require.Equal(t, tc.expTime, cs_time)
			require.Equal(t, tc.expSlot, cs.GetSlot())
			require.Equal(t, tc.expClientType, cs.ClientType())
		})
	}
}
