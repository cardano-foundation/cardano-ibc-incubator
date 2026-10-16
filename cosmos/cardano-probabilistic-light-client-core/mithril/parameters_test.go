package mithril_test

import (
	"encoding/json"
	"math"
	"math/rand"
	"strconv"
	"strings"
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	"github.com/stretchr/testify/require"
)

// Mithril authenticates phi_f only through its U8F24 encoding. A certificate
// whose metadata carries another value of the same encoding is rejected.
func TestOnlyTheCanonicalPhiFOfAnEncodingIsAccepted(t *testing.T) {
	network, err := mithriltest.NewNetwork(100, 200, 300)
	require.NoError(t, err)
	anchor := network.Anchor(7)
	certificate, err := network.StakeCertificate(7, network, strings.Repeat("ab", 32))
	require.NoError(t, err)
	_, _, err = mithril.VerifyCertificate(anchor, []byte(certificate))
	require.NoError(t, err)

	var fields map[string]any
	require.NoError(t, json.Unmarshal([]byte(certificate), &fields))
	parameters := fields["metadata"].(map[string]any)["parameters"].(map[string]any)
	require.Equal(t, 0.8, parameters["phi_f"])
	equivalent := 0.80000001
	parameters["phi_f"] = equivalent
	sameHash, err := mithril.ProtocolParametersHash(5, 50, equivalent)
	require.NoError(t, err)
	require.Equal(t, anchor.ProtocolParametersHash, sameHash)
	tampered, err := json.Marshal(fields)
	require.NoError(t, err)
	_, _, err = mithril.VerifyCertificate(anchor, tampered)
	require.ErrorContains(t, err, "not the canonical value")
}

func TestCanonicalPhiF(t *testing.T) {
	// Every decimal with up to seven digits after the point is the canonical
	// value of its own encoding.
	random := rand.New(rand.NewSource(1))
	for i := 0; i < 20000; i++ {
		digits := 1 + random.Intn(7)
		scale := math.Pow10(digits)
		decimal := float64(1+random.Int63n(int64(scale))) / scale
		value, err := strconv.ParseFloat(strconv.FormatFloat(decimal, 'f', digits, 64), 64)
		require.NoError(t, err)
		canonical, err := mithril.CanonicalPhiF(mithril.U8F24(value))
		require.NoError(t, err)
		require.Equal(t, value, canonical, "phi_f %v", value)
	}
	// Every encoding has a canonical value of its own.
	for _, code := range []uint32{1, 2, 3, 1 << 23, 3355443, 16777215, 1 << 24} {
		canonical, err := mithril.CanonicalPhiF(code)
		require.NoError(t, err)
		require.Equal(t, code, mithril.U8F24(canonical))
	}
	for _, code := range []uint32{0, 1<<24 + 1} {
		_, err := mithril.CanonicalPhiF(code)
		require.Error(t, err)
	}
}

func FuzzCanonicalPhiF(f *testing.F) {
	for _, code := range []uint32{1, 3355443, 1 << 24} {
		f.Add(code)
	}
	f.Fuzz(func(t *testing.T, code uint32) {
		canonical, err := mithril.CanonicalPhiF(code)
		if code == 0 || code > 1<<24 {
			require.Error(t, err)
			return
		}
		require.NoError(t, err)
		require.Equal(t, code, mithril.U8F24(canonical))
		again, err := mithril.CanonicalPhiF(mithril.U8F24(canonical))
		require.NoError(t, err)
		require.Equal(t, canonical, again)
	})
}
