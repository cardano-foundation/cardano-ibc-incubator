package cardanodatum

import (
	"encoding/hex"
	"encoding/json"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	tm "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
	"os"
	"testing"
	"time"
)

func TestUpgradePathIsPartOfCommittedClientState(t *testing.T) {
	data, err := os.ReadFile("../../../../tests/ibc-state-commitment/proofs.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Vectors []struct{ Committed string } }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	encoded, err := hex.DecodeString(fixture.Vectors[0].Committed)
	if err != nil {
		t.Fatal(err)
	}
	var decoded ClientStateDatum
	if err := cbor.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	expected := &tm.ClientState{
		ChainId: string(decoded.ChainId), TrustLevel: tm.Fraction{Numerator: decoded.TrustLevel.Numerator, Denominator: decoded.TrustLevel.Denominator},
		TrustingPeriod: time.Duration(decoded.TrustingPeriod), UnbondingPeriod: time.Duration(decoded.UnbondingPeriod), MaxClockDrift: time.Duration(decoded.MaxClockDrift),
		LatestHeight: clienttypes.NewHeight(decoded.LatestHeight.RevisionNumber, decoded.LatestHeight.RevisionHeight),
		ProofSpecs:   []*ics23.ProofSpec{ics23.IavlSpec, ics23.TendermintSpec}, UpgradePath: []string{"upgrade", "upgradedIBCState"},
	}
	if err := decoded.Cmp(expected); err != nil {
		t.Fatal(err)
	}
	expected.UpgradePath[1] = "forged"
	if err := decoded.Cmp(expected); err == nil {
		t.Fatal("accepted a different upgrade path")
	}
	expected.UpgradePath = nil
	if err := decoded.Cmp(expected); err == nil {
		t.Fatal("accepted a missing upgrade path")
	}
}
