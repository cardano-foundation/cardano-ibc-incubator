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
var originalHostStateDatumHex string

//go:embed host_state_datum_with_counts.hex
var countedHostStateDatumHex string

func TestGatewayHostStateDatumDecodesWithInjectivePinnedCore(t *testing.T) {
	wantPolicy := bytes.Repeat([]byte{0x24}, 28)
	wantRoot := bytes.Repeat([]byte{0x42}, 32)
	for _, fixture := range []struct {
		name string
		hex  string
	}{
		{name: "original", hex: originalHostStateDatumHex},
		{name: "with_counts", hex: countedHostStateDatumHex},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			datum, err := hex.DecodeString(strings.TrimSpace(fixture.hex))
			if err != nil {
				t.Fatalf("decode Gateway fixture: %v", err)
			}
			gotRoot, err := probabilisticcore.ExtractIbcStateRootFromHostStateDatum(datum, wantPolicy)
			if err != nil {
				t.Fatalf("Injective-pinned decoder rejected Gateway HostState datum: %v", err)
			}
			if !bytes.Equal(gotRoot, wantRoot) {
				t.Fatalf("unexpected IBC state root: got %x want %x", gotRoot, wantRoot)
			}
		})
	}
}
