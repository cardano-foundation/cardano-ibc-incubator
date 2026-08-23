package injectivecompat

import (
	"bytes"
	_ "embed"
	"encoding/hex"
	"strings"
	"testing"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

//go:embed host_state_datum.hex
var gatewayHostStateDatumHex string

func TestGatewayHostStateDatumDecodesWithInjectivePinnedCore(t *testing.T) {
	datum, err := hex.DecodeString(strings.TrimSpace(gatewayHostStateDatumHex))
	if err != nil {
		t.Fatalf("decode Gateway fixture: %v", err)
	}

	wantPolicy := bytes.Repeat([]byte{0x24}, 28)
	wantRoot := bytes.Repeat([]byte{0x42}, 32)
	gotRoot, err := probabilisticcore.ExtractIbcStateRootFromHostStateDatum(datum, wantPolicy)
	if err != nil {
		t.Fatalf("Injective-pinned decoder rejected Gateway HostState datum: %v", err)
	}
	if !bytes.Equal(gotRoot, wantRoot) {
		t.Fatalf("unexpected IBC state root: got %x want %x", gotRoot, wantRoot)
	}
}
