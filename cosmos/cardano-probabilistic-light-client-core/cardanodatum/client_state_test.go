package cardanodatum

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/cosmos/gogoproto/proto"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
)

func TestClientStateComparisonUsesAllFields(t *testing.T) {
	data, err := os.ReadFile("../../../tests/ibc-state-commitment/proofs.json")
	require.NoError(t, err)
	var fixture struct{ Vectors []struct{ Committed string } }
	require.NoError(t, json.Unmarshal(data, &fixture))
	encoded, err := hex.DecodeString(fixture.Vectors[0].Committed)
	require.NoError(t, err)
	var datum ClientStateDatum
	require.NoError(t, cbor.Unmarshal(encoded, &datum))
	fresh := func() TendermintClientStateValue {
		return TendermintClientStateValue{
			ChainId: "cosmos-2", TrustLevel: TrustLevelDatum{Numerator: 1, Denominator: 3},
			TrustingPeriod: 14 * 24 * time.Hour, UnbondingPeriod: 21 * 24 * time.Hour, MaxClockDrift: 10 * time.Second,
			LatestHeight: HeightDatum{RevisionNumber: 2, RevisionHeight: 100},
			ProofSpecs:   []*ics23.ProofSpec{proto.Clone(ics23.IavlSpec).(*ics23.ProofSpec), proto.Clone(ics23.TendermintSpec).(*ics23.ProofSpec)},
			UpgradePath:  []string{"upgrade", "upgradedIBCState"},
		}
	}
	require.NoError(t, datum.Compare(fresh()))
	for name, change := range map[string]func(*TendermintClientStateValue){
		"chain":                   func(v *TendermintClientStateValue) { v.ChainId = "other" },
		"numerator":               func(v *TendermintClientStateValue) { v.TrustLevel.Numerator++ },
		"denominator":             func(v *TendermintClientStateValue) { v.TrustLevel.Denominator++ },
		"trusting period":         func(v *TendermintClientStateValue) { v.TrustingPeriod++ },
		"unbonding period":        func(v *TendermintClientStateValue) { v.UnbondingPeriod++ },
		"clock drift":             func(v *TendermintClientStateValue) { v.MaxClockDrift++ },
		"negative duration":       func(v *TendermintClientStateValue) { v.TrustingPeriod = -1 },
		"frozen revision":         func(v *TendermintClientStateValue) { v.FrozenHeight.RevisionNumber++ },
		"frozen height":           func(v *TendermintClientStateValue) { v.FrozenHeight.RevisionHeight++ },
		"latest revision":         func(v *TendermintClientStateValue) { v.LatestHeight.RevisionNumber++ },
		"latest height":           func(v *TendermintClientStateValue) { v.LatestHeight.RevisionHeight++ },
		"nil proof specification": func(v *TendermintClientStateValue) { v.ProofSpecs[0] = nil },
		"missing upgrade path":    func(v *TendermintClientStateValue) { v.UpgradePath = nil },
		"allow expiry":            func(v *TendermintClientStateValue) { v.AllowUpdateAfterExpiry = true },
		"allow misbehaviour":      func(v *TendermintClientStateValue) { v.AllowUpdateAfterMisbehaviour = true },
	} {
		t.Run(name, func(t *testing.T) {
			v := fresh()
			change(&v)
			require.Error(t, datum.Compare(v))
		})
	}
	// Both native Bool constructors are supported. The false default must not
	// accidentally stand in for an explicitly committed true value.
	datum.ProofSpecs[0].PrehashKeyBeforeComparison = cbor.Tag{Number: 122, Content: []any{}}
	v := fresh()
	v.ProofSpecs[0].PrehashKeyBeforeComparison = true
	require.NoError(t, datum.Compare(v))
	v.ProofSpecs[0].PrehashKeyBeforeComparison = false
	require.Error(t, datum.Compare(v))
}

func TestNullaryConstructorRejectsMalformedValues(t *testing.T) {
	for _, value := range []any{nil, false, uint64(121), cbor.Tag{Number: 120, Content: []any{}}, cbor.Tag{Number: 123, Content: []any{}}, cbor.Tag{Number: 121}, cbor.Tag{Number: 121, Content: []any{1}}} {
		_, err := DecodeNullaryConstructor(value, 1)
		require.Error(t, err)
	}
}
