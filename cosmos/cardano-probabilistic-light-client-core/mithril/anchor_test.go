package mithril

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func mainnetDistribution(t *testing.T) []StakeEntry {
	t.Helper()
	var artifact struct {
		StakeDistribution map[string]uint64 `json:"stake_distribution"`
	}
	require.NoError(t, json.Unmarshal(readFixture(t, "mainnet-stake-distribution-659.json.gz"), &artifact))
	table := make([]StakeEntry, 0, len(artifact.StakeDistribution))
	for pool, stake := range artifact.StakeDistribution {
		table = append(table, StakeEntry{PoolID: pool, Stake: stake})
	}
	return table
}

// Epoch 659's distribution elects epoch 661's leaders. Its certificate, sealed
// in epoch 660, names the key that signs epoch 661's certificates.
func TestMainnetStakeAnchor(t *testing.T) {
	certificate := readFixture(t, "mainnet-epoch-660-certificate.json.gz")
	anchor, err := StakeAnchor(certificate, 661)
	require.NoError(t, err)
	require.Equal(t, uint64(661), anchor.Epoch)
	require.Equal(t, loadCertificate(t, "661").fields["aggregate_verification_key"], anchor.AggregateVerificationKey)
	_, _, err = VerifyCertificates(anchor, []string{string(readFixture(t, "mainnet-epoch-661-certificate.json.gz"))})
	require.NoError(t, err)

	_, err = StakeAnchor(certificate, 662)
	require.ErrorContains(t, err, "does not certify the epoch 660")
	_, err = StakeAnchor(certificate, 1)
	require.ErrorContains(t, err, "at least 2")
}

// With the anchor for epoch 661, epoch 661's certificate completes the
// bootstrap of a client in epoch 662, whose leaders epoch 660's distribution
// elects. Epoch 659's distribution matches the root that epoch 660's
// certificate signs.
func TestMainnetBootstrapStake(t *testing.T) {
	anchor, err := StakeAnchor(readFixture(t, "mainnet-epoch-660-certificate.json.gz"), 661)
	require.NoError(t, err)
	certificate := loadCertificate(t, "661")
	root := certificate.parts()["cardano_stake_distribution_merkle_root"].(string)
	next, err := VerifyBootstrapStake(anchor, certificate.raw, 662, root)
	require.NoError(t, err)
	require.Equal(t, uint64(662), next.Epoch)
	require.Equal(t, certificate.parts()["next_aggregate_verification_key"], next.AggregateVerificationKey)

	_, err = VerifyBootstrapStake(anchor, certificate.raw, 662, "00"+root[2:])
	require.ErrorContains(t, err, "differs from the distribution Mithril certified")
	_, err = VerifyBootstrapStake(anchor, certificate.raw, 663, root)
	require.ErrorContains(t, err, "needs the Mithril anchor for epoch 662")

	epoch659, err := StakeDistributionRoot(mainnetDistribution(t))
	require.NoError(t, err)
	require.Equal(t, loadCertificate(t, "660").parts()["cardano_stake_distribution_merkle_root"], epoch659)
}
