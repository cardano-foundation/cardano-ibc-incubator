package mithril

import (
	"compress/gzip"
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// u8f24 matches fixed 1.31.0's U8F24::from_num, the conversion Mithril hashes,
// including at half points between two encodings and their neighbours.
func TestU8F24MatchesUpstreamFixed(t *testing.T) {
	file, err := os.Open("../testdata/mithril/stm-reference-vectors.json.gz")
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	var vectors struct {
		Upstream map[string]string `json:"upstream"`
		U8F24    []struct {
			PhiFBits uint64 `json:"phi_f_bits"`
			U8F24    uint32 `json:"u8f24"`
		} `json:"u8f24"`
	}
	require.NoError(t, json.NewDecoder(reader).Decode(&vectors))
	require.Equal(t, "1.31.0", vectors.Upstream["fixed"])
	require.Greater(t, len(vectors.U8F24), 200)
	for _, vector := range vectors.U8F24 {
		phiF := math.Float64frombits(vector.PhiFBits)
		require.Equal(t, vector.U8F24, u8f24(phiF), "phi_f %v", phiF)
	}
}
