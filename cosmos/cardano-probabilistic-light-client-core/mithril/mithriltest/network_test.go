package mithriltest

import (
	"strings"
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
	"github.com/stretchr/testify/require"
)

func TestSignedStakeCertificatesVerify(t *testing.T) {
	first, err := NewNetwork(100, 200, 300, 400, 500)
	require.NoError(t, err)
	second, err := NewNetwork(700, 800, 900)
	require.NoError(t, err)
	rootA, rootB := strings.Repeat("ab", 32), strings.Repeat("cd", 32)
	certificateA, err := first.StakeCertificate(10, second, rootA)
	require.NoError(t, err)
	certificateB, err := second.StakeCertificate(11, second, rootB)
	require.NoError(t, err)

	next, distributions, err := mithril.VerifyCertificates(first.Anchor(10), []string{certificateA, certificateB})
	require.NoError(t, err)
	require.Equal(t, second.Anchor(12), next)
	require.Equal(t, []mithril.StakeDistribution{{Epoch: 9, MerkleRoot: rootA}, {Epoch: 10, MerkleRoot: rootB}}, distributions)

	// A certificate signed by keys the anchor does not name is rejected.
	forged, err := second.StakeCertificate(10, second, rootA)
	require.NoError(t, err)
	_, _, err = mithril.VerifyCertificates(first.Anchor(10), []string{forged})
	require.ErrorIs(t, err, mithril.ErrInvalidCertificate)
}
