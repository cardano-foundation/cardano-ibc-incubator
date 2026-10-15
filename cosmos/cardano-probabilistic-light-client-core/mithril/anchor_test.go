package mithril

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func mainnetDistribution(t *testing.T) (map[string]uint64, string, []StakeEntry) {
	t.Helper()
	var artifact struct {
		CertificateHash   string            `json:"certificate_hash"`
		StakeDistribution map[string]uint64 `json:"stake_distribution"`
	}
	require.NoError(t, json.Unmarshal(readFixture(t, "mainnet-stake-distribution-659.json.gz"), &artifact))
	table := make([]StakeEntry, 0, len(artifact.StakeDistribution))
	for pool, stake := range artifact.StakeDistribution {
		table = append(table, StakeEntry{PoolID: pool, Stake: stake})
	}
	return artifact.StakeDistribution, artifact.CertificateHash, table
}

// Epoch 659's distribution elects epoch 661's leaders. Its certificate, sealed
// in epoch 660, names the key that signs epoch 661's certificates.
func TestMainnetStakeAnchor(t *testing.T) {
	distribution, _, table := mainnetDistribution(t)
	certificate := readFixture(t, "mainnet-epoch-660-certificate.json.gz")
	anchor, err := StakeAnchor(certificate, distribution, 661, table)
	require.NoError(t, err)
	require.Equal(t, uint64(661), anchor.Epoch)
	require.Equal(t, loadCertificate(t, "661").fields["aggregate_verification_key"], anchor.AggregateVerificationKey)
	_, _, err = VerifyCertificates(anchor, []string{string(readFixture(t, "mainnet-epoch-661-certificate.json.gz"))})
	require.NoError(t, err)

	_, err = StakeAnchor(certificate, distribution, 662, table)
	require.ErrorContains(t, err, "does not certify the epoch 660")
	table[0].Stake++
	_, err = StakeAnchor(certificate, distribution, 661, table)
	require.ErrorContains(t, err, "differs from the bootstrap table")
	_, err = StakeAnchor(certificate, distribution, 661, table[1:])
	require.ErrorContains(t, err, "2671 pools but the bootstrap table has 2670")
	distribution[table[0].PoolID]++
	_, err = StakeAnchor(certificate, distribution, 661, table)
	require.ErrorContains(t, err, "does not match its certificate")
}

func TestFetchStakeAnchorFromAnAggregator(t *testing.T) {
	_, hash, table := mainnetDistribution(t)
	aggregator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/aggregator/artifact/cardano-stake-distribution/epoch/659":
			_, _ = w.Write(readFixture(t, "mainnet-stake-distribution-659.json.gz"))
		case "/aggregator/certificate/" + hash:
			_, _ = w.Write(readFixture(t, "mainnet-epoch-660-certificate.json.gz"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer aggregator.Close()

	anchor, err := FetchStakeAnchor(aggregator.URL+"/aggregator/", 661, table)
	require.NoError(t, err)
	require.Equal(t, loadCertificate(t, "661").fields["aggregate_verification_key"], anchor.AggregateVerificationKey)
	_, err = FetchStakeAnchor(aggregator.URL+"/aggregator", 662, table)
	require.ErrorContains(t, err, "404")
}
