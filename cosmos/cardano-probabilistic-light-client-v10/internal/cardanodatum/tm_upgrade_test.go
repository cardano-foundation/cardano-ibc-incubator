package cardanodatum

import (
	"testing"

	tm "github.com/cosmos/ibc-go/v10/modules/light-clients/07-tendermint"
	"github.com/fxamacker/cbor/v2"
)

func TestUpgradePathIsPartOfCommittedClientState(t *testing.T) {
	state := ClientStateDatum{UpgradePath: [][]byte{[]byte("upgrade"), []byte("upgradedIBCState")}}
	encoded, err := cbor.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var decoded ClientStateDatum
	if err := cbor.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	expected := &tm.ClientState{UpgradePath: []string{"upgrade", "upgradedIBCState"}}
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
