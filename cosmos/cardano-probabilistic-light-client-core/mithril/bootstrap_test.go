package mithril_test

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	"github.com/stretchr/testify/require"
)

// Mithril roots treat pool IDs as text.
const poolA, poolB = "pool1alpha", "pool1beta"

// aggregator serves certified stake distributions by epoch.
func aggregator(t *testing.T, distributions map[uint64]map[string]uint64, certificates map[uint64]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/aggregator")
		if epochText, ok := strings.CutPrefix(path, "/artifact/cardano-stake-distribution/epoch/"); ok {
			epoch, err := strconv.ParseUint(epochText, 10, 64)
			if _, found := certificates[epoch]; err != nil || !found {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"epoch": epoch, "certificate_hash": strings.Repeat(strconv.FormatUint(epoch%10, 10), 64), "stake_distribution": distributions[epoch]})
			return
		}
		for epoch, certificate := range certificates {
			if path == "/certificate/"+strings.Repeat(strconv.FormatUint(epoch%10, 10), 64) {
				_, _ = w.Write([]byte(certificate))
				return
			}
		}
		http.NotFound(w, r)
	}))
}

// A client bootstrapped in epoch 9 trusts the anchor for epoch 8, which the
// epoch 6 distribution's certificate names, and completes its bootstrap with
// the epoch 7 distribution's certificate.
func TestFetchBootstrapStake(t *testing.T) {
	network, err := mithriltest.NewNetwork(100, 200, 300)
	require.NoError(t, err)
	table := []mithril.StakeEntry{{PoolID: poolA, Stake: 1_000_000}, {PoolID: poolB, Stake: 3_000_000}}
	root, err := mithril.StakeDistributionRoot(table)
	require.NoError(t, err)
	earlier, err := network.StakeCertificate(7, network, strings.Repeat("ab", 32))
	require.NoError(t, err)
	_, certificate, err := network.Bootstrap(9, root)
	require.NoError(t, err)
	distributions := map[uint64]map[string]uint64{6: {poolA: 7, poolB: 8}, 7: {poolA: 1_000_000, poolB: 3_000_000}}
	server := aggregator(t, distributions, map[uint64]string{6: earlier, 7: certificate})
	defer server.Close()

	bootstrap, err := mithril.FetchBootstrapStake(server.URL+"/aggregator/", 9, table)
	require.NoError(t, err)
	require.Equal(t, network.Anchor(8), bootstrap.Anchor)
	require.Equal(t, certificate, string(bootstrap.Certificate))
	next, err := mithril.VerifyBootstrapStake(bootstrap.Anchor, bootstrap.Certificate, 9, root)
	require.NoError(t, err)
	require.Equal(t, network.Anchor(9), next)

	// The table must be the distribution Mithril certified.
	_, err = mithril.FetchBootstrapStake(server.URL+"/aggregator", 9, []mithril.StakeEntry{{PoolID: poolA, Stake: 999_999}, {PoolID: poolB, Stake: 3_000_000}})
	require.ErrorContains(t, err, "differs from the bootstrap table for pool "+poolA)
	// The aggregator has not certified the distribution for epoch 10 yet.
	_, err = mithril.FetchBootstrapStake(server.URL+"/aggregator", 10, table)
	require.ErrorContains(t, err, "404")
	_, err = mithril.FetchBootstrapStake(server.URL+"/aggregator", 2, table)
	require.ErrorContains(t, err, "at least 3")
}

// A certificate signed by another Mithril network does not bootstrap a client.
func TestBootstrapStakeNeedsTheAnchorsSigners(t *testing.T) {
	network, err := mithriltest.NewNetwork(100, 200, 300)
	require.NoError(t, err)
	other, err := mithriltest.NewNetwork(400, 500)
	require.NoError(t, err)
	root := strings.Repeat("cd", 32)
	_, certificate, err := other.Bootstrap(9, root)
	require.NoError(t, err)
	_, err = mithril.VerifyBootstrapStake(network.Anchor(8), []byte(certificate), 9, root)
	require.ErrorIs(t, err, mithril.ErrInvalidCertificate)
	// The certificate must certify the stake that elects epoch 9's leaders.
	unstaked, err := network.Certificate(map[string]string{
		"next_aggregate_verification_key": network.AggregateVerificationKey,
		"next_protocol_parameters":        network.ProtocolParametersHash,
		"current_epoch":                   "8",
	})
	require.NoError(t, err)
	_, err = mithril.VerifyBootstrapStake(network.Anchor(8), []byte(unstaked), 9, root)
	require.ErrorContains(t, err, "does not certify the stake distribution that elects epoch 9")
}

// A single pool's root is its mountain range leaf rather than a hash, and its
// certificate bootstraps a client.
func TestSinglePoolBootstrapStake(t *testing.T) {
	network, err := mithriltest.NewNetwork(100)
	require.NoError(t, err)
	root, err := mithril.StakeDistributionRoot([]mithril.StakeEntry{{PoolID: poolA, Stake: 5}})
	require.NoError(t, err)
	require.Equal(t, hex.EncodeToString([]byte(poolA+"5")), root)
	anchor, certificate, err := network.Bootstrap(4, root)
	require.NoError(t, err)
	_, err = mithril.VerifyBootstrapStake(anchor, []byte(certificate), 4, root)
	require.NoError(t, err)
}
