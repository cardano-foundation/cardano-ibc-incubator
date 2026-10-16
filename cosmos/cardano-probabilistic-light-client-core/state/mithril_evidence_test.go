package state

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// A table accepted under the response window stays checkable against a late
// certificate after retention cleanup deletes its activated record, so a
// relayer can catch up on several epochs of certificates at once.
func TestLateCertificatesCheckAcceptedStakeAfterCleanup(t *testing.T) {
	later := []string{strings.Repeat("91", 32), strings.Repeat("a1", 32)}
	for _, test := range []struct {
		name       string
		contradict int
	}{
		{"agreeing", -1},
		{"contradicting the cleaned-up table", 0},
		{"contradicting a later table", 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := newAnchoredClient(t)
			epoch := a.table.Epoch
			a.stage(t)
			proposedAt := a.ctx.Time
			require.NoError(t, a.activateAt(t, proposedAt))
			require.NoError(t, a.activateAt(t, proposedAt.Add(SharedSnapshotChallengePeriod+time.Second)))
			require.Equal(t, epoch, a.client.CurrentEpoch)
			generation := a.client.VerificationGeneration
			require.Equal(t, tableRoot(t, a.table), string(a.private.Get(acceptedStakeRootKey(generation, epoch))))
			// The fixture crosses one epoch boundary. Later tables accepted under
			// the response window are recorded as their activations record them.
			for offset, root := range later {
				require.NoError(t, recordAcceptedStake(a.private, generation, epoch+uint64(offset)+1, root))
			}

			a.ctx.Time = time.Unix(0, int64(retentionDeadline(a.client, uint64(proposedAt.UnixNano())))).Add(time.Hour)
			for i := 0; i < 64 && len(a.shared.Get(activatedEpochKey(a.client, epoch))) > 0; i++ {
				require.NoError(t, a.client.ContinueMaintenance(a.ctx, a.cdc, a.private, ObservationCleanup))
			}
			require.Empty(t, a.shared.Get(activatedEpochKey(a.client, epoch)), "cleanup removes the activated table")
			require.Equal(t, tableRoot(t, a.table), string(a.private.Get(acceptedStakeRootKey(generation, epoch))), "cleanup keeps its accepted root")

			// Mithril's certificates for the three epochs arrive together.
			roots := append([]string{tableRoot(t, a.table)}, later...)
			if test.contradict >= 0 {
				roots[test.contradict] = strings.Repeat("ee", 32)
			}
			var certificates []string
			for offset, root := range roots {
				certificate, err := a.network.StakeCertificate(a.client.MithrilEpoch+uint64(offset), a.network, root)
				require.NoError(t, err)
				certificates = append(certificates, certificate)
			}
			msg := &MithrilStakeCertificates{Certificates: certificates}
			require.NoError(t, a.client.VerifyClientMessage(a.ctx, a.cdc, a.private, msg))
			if test.contradict >= 0 {
				require.True(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
				a.client.UpdateStateOnMisbehaviour(a.ctx, a.cdc, a.private, msg)
				frozen, found := GetClientState(a.private, a.cdc)
				require.True(t, found)
				require.Equal(t, Frozen, frozen.Status(a.ctx, a.private, a.cdc))
				return
			}
			require.False(t, a.client.CheckForMisbehaviour(a.ctx, a.cdc, a.private, msg))
			require.Empty(t, a.client.UpdateState(a.ctx, a.cdc, a.private, msg))
			updated, _ := GetClientState(a.private, a.cdc)
			require.Equal(t, epoch+uint64(len(roots))-1, updated.MithrilEpoch)
			for offset, root := range roots {
				leader := epoch + uint64(offset)
				require.Nil(t, a.private.Get(acceptedStakeRootKey(generation, leader)), "a certificate supersedes the accepted root")
				certified, err := requireCertifiedStake(a.private, generation, leader, root)
				require.NoError(t, err)
				require.True(t, certified)
			}
		})
	}
}
