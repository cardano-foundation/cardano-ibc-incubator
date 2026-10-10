package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPraosNonceContributionReferenceVectors(t *testing.T) {
	// Cardano.Protocol.Praos.VRF.vrfNonceValue, cardano-ledger 56ddee12.
	// Fixed vectors independently evaluated with Python hashlib.blake2b.
	sequence := make([]byte, 64)
	for i := range sequence {
		sequence[i] = byte(i)
	}
	for _, tc := range []struct {
		input    []byte
		expected string
	}{
		{make([]byte, 64), "54497fc0d024bd93b29b167acae8ee6c006c4f53103ae16ba8cf5c2ec88577b7"},
		{sequence, "b19e65495ab5916dcb696eef8173ebe40aec344a1a4f627d64c8fd0738399248"},
	} {
		actual, err := PraosNonceContribution(tc.input)
		require.NoError(t, err)
		require.Equal(t, tc.expected, hex.EncodeToString(actual))
	}
	_, err := PraosNonceContribution(make([]byte, 32))
	require.Error(t, err)
}

func TestPraosNonceIdentityAndHashCasting(t *testing.T) {
	left, right := bytes.Repeat([]byte{0x11}, 32), bytes.Repeat([]byte{0x22}, 32)
	combined, err := CombinePraosNonces(left, right)
	require.NoError(t, err)
	require.Equal(t, "428d37d6b34f605a8ff32b6a04c95d9c7d2aead9ecde193b2f5019b7f13ced23", hex.EncodeToString(combined))
	for _, args := range [][2][]byte{{nil, left}, {left, nil}} {
		actual, err := CombinePraosNonces(args[0], args[1])
		require.NoError(t, err)
		require.Equal(t, left, actual)
		actual[0] = 0xff
		require.Equal(t, byte(0x11), left[0])
	}
	neutral, err := CombinePraosNonces(nil, nil)
	require.NoError(t, err)
	require.Empty(t, neutral)
	_, err = CombinePraosNonces(left, []byte{1})
	require.Error(t, err)
	parent, err := PraosPreviousHashNonce(hex.EncodeToString(left))
	require.NoError(t, err)
	require.Equal(t, left, parent)
	neutral, err = PraosPreviousHashNonce("")
	require.NoError(t, err)
	require.Empty(t, neutral)
	_, err = PraosPreviousHashNonce("01")
	require.Error(t, err)
}
