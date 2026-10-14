package mithril

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	gogotypes "github.com/cosmos/gogoproto/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	tm "github.com/cosmos/ibc-go/v10/modules/light-clients/07-tendermint"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestMembershipPreservesBothCommittedClientFormats(t *testing.T) {
	data, err := os.ReadFile("../../tests/ibc-state-commitment/codec.json")
	require.NoError(t, err)
	var fixture struct {
		MixedProofs []struct {
			Key, Committed, Root string
			Proof                json.RawMessage
		}
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Len(t, fixture.MixedProofs, 2)
	require.Equal(t, fixture.MixedProofs[0].Root, fixture.MixedProofs[1].Root)
	for i, vector := range fixture.MixedProofs {
		root, err := hex.DecodeString(vector.Root)
		require.NoError(t, err)
		state := &tm.ClientState{
			ChainId: "cosmos-2", TrustLevel: tm.Fraction{Numerator: 1, Denominator: 3},
			TrustingPeriod: 14 * 24 * time.Hour, UnbondingPeriod: 21 * 24 * time.Hour, MaxClockDrift: 10 * time.Second,
			LatestHeight: clienttypes.NewHeight(2, 100), ProofSpecs: []*ics23.ProofSpec{ics23.IavlSpec, ics23.TendermintSpec},
		}
		if i == 0 {
			state.UpgradePath = []string{"upgrade", "upgradedIBCState"}
		}
		expected := func() []byte {
			value, err := state.Marshal()
			require.NoError(t, err)
			value, err = (&gogotypes.Any{TypeUrl: "/ibc.lightclients.tendermint.v1.ClientState", Value: value}).Marshal()
			require.NoError(t, err)
			return value
		}
		require.NoError(t, VerifyIbcStateMembership(root, []byte(vector.Key), expected(), vector.Proof))
		var wrongType gogotypes.Any
		require.NoError(t, wrongType.Unmarshal(expected()))
		wrongType.TypeUrl = "/ibc.lightclients.tendermint.v1.ConsensusState"
		wrongValue, err := wrongType.Marshal()
		require.NoError(t, err)
		require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), wrongValue, vector.Proof))

		// The authenticated bytes cannot supply an absent setting or another shape.
		state.UpgradePath = []string{"uncommitted"}
		require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), expected(), vector.Proof))
		state.UpgradePath = nil
		if i == 0 {
			state.UpgradePath = []string{"upgrade", "upgradedIBCState"}
		}
		state.AllowUpdateAfterMisbehaviour = true
		require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), expected(), vector.Proof))
		state.AllowUpdateAfterMisbehaviour = false
		committed, err := hex.DecodeString(vector.Committed)
		require.NoError(t, err)
		require.Error(t, VerifyIbcStateMembership(root, []byte(vector.Key), committed, vector.Proof))
		require.Error(t, VerifyIbcStateMembership(root, []byte(fixture.MixedProofs[1-i].Key), expected(), vector.Proof))
		forgedRoot := bytes.Clone(root)
		forgedRoot[0] ^= 1
		require.Error(t, VerifyIbcStateMembership(forgedRoot, []byte(vector.Key), expected(), vector.Proof))
	}
}
